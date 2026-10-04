// Compare invoices/bills across the three places they can live, by id and ref:
//   blob        app_state key deed_invoices (legacy rollback copy)
//   projection  erp_state_records key deed_invoices (what the app reads)
//   table       invoices (normalized Prisma table)
//
//   node scripts/invoice-parity.mjs                 # report only (read-only)
//   node scripts/invoice-parity.mjs --apply         # copy blob-only records into the projection
//
// --apply only INSERTS projection rows for ids that the projection lacks. It
// never updates, reorders or deletes existing rows and never touches app_state.
// Records that exist in the projection are treated as newer than the blob.

import 'dotenv/config'
import { createHash } from 'crypto'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const connectionString = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('Missing database URL env var'); process.exit(1) }

const KEY = 'deed_invoices'
const pool = new pg.Pool({ connectionString })

const compact = (v, max = 220) => v.length <= max ? v : `${v.slice(0, max - 17)}:${createHash('sha256').update(v).digest('hex').slice(0, 16)}`
const line = r => `${String(r.ref ?? '').padEnd(14)} ${String(r.type ?? '').padEnd(12)} ${String(r.status ?? '').padEnd(10)} ${String(r.date ?? '').slice(0, 10)}  ${r.partnerName ?? ''}  total=${r.total ?? ''}  id=${r.id}`

try {
  const blobRow = (await pool.query('SELECT value FROM app_state WHERE key = $1', [KEY])).rows[0]
  const blob = blobRow ? JSON.parse(blobRow.value) : []
  const proj = (await pool.query('SELECT payload, position FROM erp_state_records WHERE key = $1 ORDER BY position', [KEY])).rows
  const tbl = (await pool.query('SELECT id, invoice_number FROM invoices')).rows

  const projIds = new Set(proj.map(r => String(r.payload?.id)))
  const projRefs = new Set(proj.map(r => String(r.payload?.ref)))
  const tblIds = new Set(tbl.map(r => String(r.id)))
  const tblRefs = new Set(tbl.map(r => String(r.invoice_number)))

  const blobOnly = blob.filter(b => !projIds.has(String(b.id)))
  const blobOnlyRefClash = blobOnly.filter(b => projRefs.has(String(b.ref)))
  const projNotInTable = proj.map(r => r.payload).filter(p => !tblIds.has(String(p.id)) && !tblRefs.has(String(p.ref)))
  const tableNotInProj = tbl.filter(t => !projIds.has(String(t.id)) && !projRefs.has(String(t.invoice_number)))

  const byType = list => list.reduce((m, r) => { const k = r.type ?? '?'; m[k] = (m[k] || 0) + 1; return m }, {})
  console.log(JSON.stringify({
    counts: { blob: blob.length, projection: proj.length, table: tbl.length },
    blobByType: byType(blob),
    projectionByType: byType(proj.map(r => r.payload)),
    blobOnly: blobOnly.length,
    blobOnlyWhoseRefAlreadyInProjection: blobOnlyRefClash.length,
    projectionNotInTable: projNotInTable.length,
    tableNotInProjection: tableNotInProj.length,
  }, null, 2))

  if (blobOnly.length) {
    console.log('\nIn the blob but missing from the projection (hidden in the app):')
    for (const r of blobOnly.slice(0, 200)) console.log('  ' + line(r))
  }
  if (tableNotInProj.length) {
    console.log('\nIn the invoices table but missing from the projection:')
    for (const r of tableNotInProj.slice(0, 200)) console.log(`  ${r.invoice_number}  id=${r.id}`)
  }

  if (!apply) { console.log('\nReport only. Re-run with --apply to copy blob-only records into the projection.'); process.exit(0) }

  const toCopy = blobOnly.filter(b => b && b.id && !projRefs.has(String(b.ref)))
  const skipped = blobOnly.length - toCopy.length
  if (!toCopy.length) { console.log('\nNothing safe to copy.'); process.exit(0) }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO erp_state_keys (key, kind, value, version, created_at, updated_at)
       VALUES ($1, 'collection', NULL, 1, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET version = erp_state_keys.version + 1, updated_at = NOW()`, [KEY])
    let pos = (await client.query('SELECT COALESCE(MAX(position), -1) AS m FROM erp_state_records WHERE key = $1', [KEY])).rows[0].m
    for (const payload of toCopy) {
      const recordKey = compact(`id:${String(payload.id).trim()}`)
      const id = `${KEY}:${createHash('sha256').update(recordKey).digest('hex').slice(0, 32)}`
      await client.query(
        `INSERT INTO erp_state_records (id, key, record_key, position, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
         ON CONFLICT (key, record_key) DO NOTHING`,
        [id, KEY, recordKey, ++pos, JSON.stringify(payload)])
    }
    await client.query('COMMIT')
    console.log(`\nCopied ${toCopy.length} record(s) into the projection. Skipped ${skipped} whose ref already exists there.`)
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
} finally { await pool.end() }
