#!/usr/bin/env node
/**
 * Align the blob deed_accounts (UI Chart of Accounts / product account pickers)
 * with the relational account_codes table after the CoA alignment migration:
 *
 *   1. Existing blob rows adopt the table's type/name/group/subGroup by code
 *      (fixes e.g. 3000 Accounts Payable typed as 'asset').
 *   2. Accounts present in account_codes but missing from the blob are appended
 *      (id `coa-prisma-<code>`, balance 0) so the UI shows the full chart.
 *
 * Balances and isDynamic flags on existing blob rows are preserved; live TB
 * derives from journal_entry_lines, not blob balances. Idempotent.
 *
 * Usage (on the app host, from the app root with .env present):
 *   node scripts/fix-coa-blob-alignment.mjs --dry-run
 *   node scripts/fix-coa-blob-alignment.mjs
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
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
const connectionString = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No DATABASE_URL/POSTGRES_URL found (env or .env).')
  process.exit(2)
}

const pool = new Pool({ connectionString })

const { rows: stateRows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_accounts'`)
if (!stateRows.length) {
  console.log('deed_accounts blob not present — nothing to align.')
  await pool.end()
  process.exit(0)
}

const blob = JSON.parse(typeof stateRows[0].value === 'string' ? stateRows[0].value : JSON.stringify(stateRows[0].value))
if (!Array.isArray(blob)) {
  console.error('deed_accounts blob is not an array; refusing to touch it.')
  await pool.end()
  process.exit(2)
}

const { rows: coa } = await pool.query(
  `SELECT code, name, account_type, account_group, sub_group, is_active, is_dynamic, dynamic_key, notes FROM account_codes`,
)
const byCode = new Map(coa.map(r => [String(r.code), r]))

let corrected = 0
const next = blob.map(a => {
  const code = String(a?.code ?? '').trim()
  const live = byCode.get(code)
  if (!live) return a
  const want = {
    name: live.name,
    type: live.account_type,
    group: live.account_group || a.group || 'General',
    subGroup: live.sub_group || a.subGroup || 'General',
  }
  if (a.name === want.name && a.type === want.type && a.group === want.group && a.subGroup === want.subGroup) return a
  corrected++
  return { ...a, ...want }
})

const have = new Set(next.map(a => String(a?.code ?? '').trim()))
const additions = coa
  .filter(r => !have.has(String(r.code)))
  .map(r => ({
    id: `coa-prisma-${r.code}`,
    code: String(r.code),
    name: r.name,
    type: r.account_type,
    group: r.account_group || 'General',
    subGroup: r.sub_group || 'General',
    isActive: r.is_active !== false,
    balance: 0,
    isDynamic: Boolean(r.is_dynamic),
    ...(r.dynamic_key ? { dynamicKey: r.dynamic_key } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
  }))

console.log(`Blob rows: ${blob.length} → ${next.length + additions.length} (corrected ${corrected}, added ${additions.length})`)
if (DRY) {
  console.log('DRY RUN — additions:', additions.map(a => a.code).join(', ') || '(none)')
  await pool.end()
  process.exit(0)
}

await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = 'deed_accounts'`, [JSON.stringify([...next, ...additions])])
console.log('deed_accounts blob aligned with account_codes.')
await pool.end()
