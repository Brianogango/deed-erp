#!/usr/bin/env node
/**
 * Repairs that show Ready / Invoiced now but were further along (released,
 * delivered, collected, closed) in an earlier nightly backup. Their record no
 * longer carries any trace — a stale save or the August restore rewound the
 * status and its history together — so the backups are the evidence.
 *
 * Read-only unless --apply is given. Reads each backup's dump as text
 * (pg_restore -f -), nothing is restored anywhere.
 *
 *   cd /var/www/deed-erp
 *   sudo node scripts/repairs-status-from-backups.mjs            > /tmp/repairs-backups.txt
 *   sudo node scripts/repairs-status-from-backups.mjs --apply     # put them back
 *
 * Options: --since YYYY-MM-DD (only backups on/after), --max-backups N (default 120)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['.env', '.env.local', '.env.production']) {
  const path = resolve(ROOT, file)
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || m[1] in process.env) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback }
const APPLY = process.argv.includes('--apply')
const SINCE = arg('--since', '')
const MAX = Number(arg('--max-backups', '120')) || 120
const BACKUP_ROOT = process.env.BACKUP_DIR || '/var/backups/deed-erp'
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!DB_URL) { console.error('DATABASE_URL is not set'); process.exit(1) }

// Past Ready, in workflow order; the furthest one seen wins.
const BEYOND = ['verified_released', 'delivered', 'collected', 'closed']
const rank = s => BEYOND.indexOf(String(s ?? ''))
const COLUMN_STATUS = { verified_released: 'verified_released', delivered: 'collected', collected: 'collected', closed: 'collected' }
// Completion details copied back from the backup when the live record lacks them.
const COMPLETION_KEYS = ['collectedDate', 'closedDate', 'deliveryActualDate', 'deliveryRecipient', 'deliveryRecipientPhone', 'conditionOnRelease', 'releasedBy', 'collectedBy']

/** One COPY text field → string (null for \N). */
function unescapeCopy(field) {
  if (field === '\\N') return null
  return field.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', '\\': '\\' }[c] ?? c))
}

/** Every repair object found in one backup: ref → the record. */
async function repairsInBackup(dump) {
  const out = new Map()
  const keep = (r) => {
    if (!r || typeof r !== 'object') return
    const ref = String(r.ref ?? '').trim()
    if (!ref) return
    const prev = out.get(ref)
    // The same job may be in the table and an older list copy: keep the further one.
    if (!prev || rank(r.status) > rank(prev.status)) out.set(ref, r)
  }
  const proc = spawn('pg_restore', ['--data-only', '-t', 'repairs', '-t', 'app_state', '-t', 'erp_state_records', '-f', '-', dump], { stdio: ['ignore', 'pipe', 'pipe'] })
  let errText = ''
  proc.stderr.on('data', d => { errText += d })
  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
  let table = null
  let cols = []
  for await (const line of rl) {
    if (table === null) {
      const m = line.match(/^COPY public\.(repairs|app_state|erp_state_records) \(([^)]*)\) FROM stdin;$/)
      if (m) { table = m[1]; cols = m[2].split(',').map(c => c.trim().replace(/"/g, '')) }
      continue
    }
    if (line === '\\.') { table = null; continue }
    const fields = line.split('\t').map(unescapeCopy)
    const get = name => fields[cols.indexOf(name)]
    try {
      if (table === 'repairs') {
        const payload = get('payload')
        if (payload) keep(JSON.parse(payload))
      } else if (table === 'app_state' && get('key') === 'deed_repairs_v2') {
        const list = JSON.parse(get('value') ?? '[]')
        if (Array.isArray(list)) list.forEach(keep)
      } else if (table === 'erp_state_records' && get('key') === 'deed_repairs_v2') {
        const payload = get('payload')
        if (payload) keep(JSON.parse(payload))
      }
    } catch { /* a row that is not JSON is skipped */ }
  }
  await new Promise(res => proc.on('close', res))
  return { repairs: out, error: out.size === 0 ? errText.slice(0, 200) : '' }
}

const sets = existsSync(BACKUP_ROOT)
  ? readdirSync(BACKUP_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
      .map(name => ({ name, dump: join(BACKUP_ROOT, name, 'database.dump') }))
      .filter(s => existsSync(s.dump) && statSync(s.dump).size > 0)
      .map(s => ({ ...s, taken: statSync(s.dump).mtime.toISOString().slice(0, 10) }))
      .filter(s => !SINCE || s.taken >= SINCE)
      .slice(-MAX)
  : []
if (!sets.length) { console.error(`No readable backups in ${BACKUP_ROOT}`); process.exit(1) }

const pool = new pg.Pool({ connectionString: DB_URL })
const live = (await pool.query(`SELECT id, job_number, payload FROM repairs WHERE payload->>'status' IN ('ready', 'invoiced')`)).rows
const liveByRef = new Map(live.map(r => [r.job_number, r]))
console.log(`${live.length} repairs show Ready / Invoiced now. Reading ${sets.length} backups (${sets[0].taken} … ${sets.at(-1).taken}).`)

// ref → { status, record, seenIn } — the furthest status any backup holds.
const furthest = new Map()
for (const set of sets) {
  process.stderr.write(`  reading ${set.name} (${set.taken})…\n`)
  const { repairs, error } = await repairsInBackup(set.dump)
  if (error) { console.log(`  ${set.name}: could not read (${error})`); continue }
  for (const ref of liveByRef.keys()) {
    const r = repairs.get(ref)
    if (!r || rank(r.status) < 0) continue
    const prev = furthest.get(ref)
    if (!prev || rank(r.status) >= rank(prev.status)) furthest.set(ref, { status: r.status, record: r, seenIn: set.taken })
  }
}

const found = [...furthest.entries()].sort((a, b) => a[0].localeCompare(b[0]))
console.log(`\n${found.length} of them were further along in a backup:\n`)
console.log('ref | customer | now | was | last seen there | collected / closed')
for (const [ref, f] of found) {
  const now = liveByRef.get(ref).payload
  const when = [f.record.collectedDate, f.record.closedDate].filter(Boolean).map(d => String(d).slice(0, 10)).join(' / ') || '-'
  console.log(`${ref} | ${now.customerName ?? ''} | ${now.status} | ${f.status} | ${f.seenIn} | ${when}`)
}

if (!APPLY) {
  console.log(`\nNothing changed. Re-run with --apply to put these ${found.length} back.`)
  await pool.end()
  process.exit(0)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const [ref, f] of found) {
    const row = liveByRef.get(ref)
    const next = { ...row.payload, status: f.status }
    for (const key of COMPLETION_KEYS) if (next[key] == null && f.record[key] != null) next[key] = f.record[key]
    const history = Array.isArray(next.statusHistory) ? next.statusHistory : []
    next.statusHistory = [...history, { status: f.status, date: new Date().toISOString(), by: 'system', note: `Restored from backup of ${f.seenIn} (was shown as ${row.payload.status})` }]
    await client.query(
      `UPDATE repairs SET payload = $1::jsonb, status = $2::repair_status, updated_at = now() WHERE id = $3`,
      [JSON.stringify(next), COLUMN_STATUS[f.status], row.id],
    )
  }
  await client.query('COMMIT')
  console.log(`\nPut back ${found.length} repairs. Open screens pick it up on their next refresh.`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('Nothing changed:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
