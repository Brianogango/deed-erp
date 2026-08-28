#!/usr/bin/env node
/* One-off: collapse same-id rows in deed_contacts left by the merge's textual
 * repoint (dupe rows were rewritten to the kept id). Keeps the row with the
 * earliest createdAt, preferring one with phone/email. */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DRY = process.argv.includes('--dry-run')

for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq <= 0) continue
  const key = t.slice(0, eq).trim()
  let value = t.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  if (!(key in process.env)) process.env[key] = value
}

const pool = new Pool({ connectionString: process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL })
const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_contacts'`)
const arr = JSON.parse(typeof rows[0].value === 'string' ? rows[0].value : JSON.stringify(rows[0].value))

const byId = new Map()
for (const c of arr) {
  const id = String(c?.id ?? '')
  if (!id) continue
  const prev = byId.get(id)
  if (!prev) { byId.set(id, c); continue }
  const score = (x) => (x?.createdAt || x?.created_at || '9999') + (x?.phone || x?.email ? '0' : '1')
  byId.set(id, score(c) < score(prev) ? c : prev)
}
const out = [...byId.values()]
console.log(`deed_contacts: ${arr.length} → ${out.length}`)
if (!DRY && out.length !== arr.length) {
  await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = 'deed_contacts'`, [JSON.stringify(out)])
  console.log('written')
}
await pool.end()
