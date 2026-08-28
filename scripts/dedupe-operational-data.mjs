#!/usr/bin/env node
/**
 * Dedupe operational data after the inventory/sales audit:
 *
 *   1. deed_serials — drop same-id duplicate rows (GRN validate appended
 *      client copies after the server had already persisted them).
 *   2. clients — merge exact duplicate contacts: same normalized name AND no
 *      conflicting phone (all non-empty phones must share the same last 9
 *      digits). Keeps the oldest record, fills empty phone/email from dupes,
 *      repoints every FK reference (discovered from information_schema) and
 *      every app_state blob occurrence, then deletes the dupe rows.
 *      Groups with conflicting phones are reported and skipped.
 *
 * Idempotent. Always run --dry-run first.
 *
 *   node scripts/dedupe-operational-data.mjs --dry-run
 *   node scripts/dedupe-operational-data.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DRY = process.argv.includes('--dry-run')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let value = t.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
const connectionString = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('No DATABASE_URL'); process.exit(2) }

const pool = new Pool({ connectionString })
const last9 = (p) => String(p || '').replace(/\D/g, '').slice(-9)

// ── 1. deed_serials same-id dupes ────────────────────────────────────────────
{
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_serials'`)
  if (rows.length) {
    const serials = JSON.parse(typeof rows[0].value === 'string' ? rows[0].value : JSON.stringify(rows[0].value))
    const seen = new Set()
    const deduped = serials.filter(s => {
      const id = String(s?.id ?? '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    const removed = serials.length - deduped.length
    console.log(`deed_serials: ${serials.length} → ${deduped.length} (removed ${removed} same-id dupes)`)
    if (!DRY && removed > 0) {
      await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = 'deed_serials'`, [JSON.stringify(deduped)])
    }
  }
}

// ── 2. client merge ──────────────────────────────────────────────────────────
const { rows: clients } = await pool.query(`SELECT id, name, phone, email, created_at FROM clients ORDER BY created_at ASC`)
const groups = new Map()
for (const c of clients) {
  const key = String(c.name || '').trim().toLowerCase()
  if (!key) continue
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(c)
}

const merges = []
const skipped = []
for (const [name, rows] of groups) {
  if (rows.length < 2) continue
  const phones = new Set(rows.map(r => last9(r.phone)).filter(p => p.length === 9))
  if (phones.size > 1) {
    skipped.push(`${name} (conflicting phones — left alone)`)
    continue
  }
  const keep = rows[0]
  const dupes = rows.slice(1)
  const fillEmail = keep.email || dupes.find(d => d.email)?.email || null
  const fillPhone = keep.phone || dupes.find(d => d.phone)?.phone || null
  merges.push({ name, keep, dupes, fillEmail, fillPhone })
}

if (!merges.length && !skipped.length) {
  console.log('clients: no duplicate groups')
}
for (const s of skipped) console.log(`  SKIP ${s}`)

const { rows: fkCols } = await pool.query(`
  SELECT conrelid::regclass::text AS table_name, a.attname AS column_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.contype = 'f' AND c.confrelid = 'clients'::regclass
`)

for (const m of merges) {
  const dupeIds = m.dupes.map(d => d.id)
  console.log(`MERGE "${m.name}": keep ${m.keep.id} ← ${dupeIds.length} dupe(s)`)
  if (DRY) continue
  await pool.query('BEGIN')
  try {
    if ((m.fillEmail && !m.keep.email) || (m.fillPhone && !m.keep.phone)) {
      await pool.query(`UPDATE clients SET email = COALESCE(NULLIF(email, ''), $2), phone = COALESCE(NULLIF(phone, ''), $3) WHERE id = $1`, [m.keep.id, m.fillEmail, m.fillPhone])
    }
    for (const fk of fkCols) {
      await pool.query(
        `UPDATE "${fk.table_name}" SET "${fk.column_name}" = $1 WHERE "${fk.column_name}" = ANY($2::uuid[])`,
        [m.keep.id, dupeIds],
      )
    }
    await pool.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [dupeIds])
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }

  // Blob stores: repoint every textual occurrence of a dupe UUID.
  const { rows: stateRows } = await pool.query(`SELECT key, value FROM app_state`)
  for (const row of stateRows) {
    let text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value)
    const hasDupeRow = row.key === 'deed_contacts' && dupeIds.some(id => text.includes(id))
    let touched = hasDupeRow
    // deed_contacts: drop the dupe rows first (by their original ids) so the
    // surviving record is the kept contact, not a rewritten dupe.
    if (hasDupeRow) {
      try {
        const arr = JSON.parse(text)
        if (Array.isArray(arr)) text = JSON.stringify(arr.filter(c => !dupeIds.includes(String(c?.id))))
      } catch { /* fall through to textual replace */ }
    }
    for (const dupeId of dupeIds) {
      if (text.includes(dupeId)) {
        text = text.split(dupeId).join(m.keep.id)
        touched = true
      }
    }
    if (!touched) continue
    await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = $2`, [text, row.key])
    console.log(`  blob ${row.key}: repointed`)
  }
}

console.log(`clients: ${merges.length} groups merged, ${skipped.length} skipped, ${clients.length} → ${clients.length - merges.reduce((a, m) => a + m.dupes.length, 0)} rows`)
if (DRY) console.log('DRY RUN — nothing written.')
await pool.end()
