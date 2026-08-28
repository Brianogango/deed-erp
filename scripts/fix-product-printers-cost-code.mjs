#!/usr/bin/env node
/**
 * One-off correction after fix-coa-blob-alignment.mjs:
 * the blanket 6108 → 6114 remap was meant for the account row (old 6108 was
 * "Trade-in Purchases"), but product cost overrides already used 6108 in the
 * official sense (Local Purchases — Printers). Trade-in is a settlement
 * account, never a product default, so any product on 6114 goes back to 6108.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

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
const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_products'`)
if (!rows.length) { console.log('deed_products missing'); await pool.end(); process.exit(0) }
const products = JSON.parse(typeof rows[0].value === 'string' ? rows[0].value : JSON.stringify(rows[0].value))
let fixed = 0
for (const p of products) {
  if (p && p.costAccountCode === '6114') { p.costAccountCode = '6108'; fixed++ }
}
if (fixed > 0 && !process.argv.includes('--dry-run')) {
  await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = 'deed_products'`, [JSON.stringify(products)])
}
console.log(`products corrected 6114 -> 6108 (Printers): ${fixed}`)
await pool.end()
