#!/usr/bin/env node
/**
 * Align blob accounting data with the official DEED chart of accounts after
 * database/migrations/20260828_official_coa_alignment_safe.sql:
 *
 *   1. deed_accounts: apply the same code renumbering (row ids follow), then
 *      sync type/name/group from account_codes and append accounts the blob
 *      is missing.
 *   2. deed_products: remap product account overrides — 6200/6205/6210 become
 *      6305/6306/6307, opening-stock codes (11xx) used as the inventory asset
 *      account become 1200, service/software sale codes 5003 become
 *      5101/5009, and any override pointing at a code that does not exist is
 *      cleared so category defaults take over.
 *
 * Balances and isDynamic flags on existing blob rows are preserved. Idempotent.
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

/** account_codes renumbering applied by 20260828_official_coa_alignment_safe.sql */
const RENUMBER = {
  6201: '6601', 6202: '6606', 6203: '6609',
  6200: '6305', 6205: '6306', 6210: '6307',
  6401: '6703', 6405: '6518', 6430: '6511', 6495: '6595', 6499: '6599',
  3305: '3302', 3306: '3303', 3307: '3304', 3308: '3305', 3309: '3306',
  3110: '3310', 3105: '3312', 3102: '3313', 3005: '3202',
  1805: '1933', 1810: '1931',
  5003: '5101', 5105: '5201', 6108: '6114',
}

/**
 * Product overrides use the official grid already — only the inventory
 * variance family moved for them. (6108 on a product means Local Purchases —
 * Printers, not the old Trade-in row; never remap product 6108.)
 */
const PRODUCT_RENUMBER = {
  6200: '6305', 6205: '6306', 6210: '6307',
}

/** Product override fields that hold account codes. */
const PRODUCT_CODE_FIELDS = [
  'saleAccountCode',
  'costAccountCode',
  'inventoryAccountCode',
  'cogsAccountCode',
  'adjustmentAccountCode',
  'writeOffAccountCode',
  'priceDifferenceAccountCode',
]

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

const readBlob = async (key) => {
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = $1`, [key])
  if (!rows.length) return null
  const raw = rows[0].value
  return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw))
}
const writeBlob = async (key, value) => {
  await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = $2`, [JSON.stringify(value), key])
}

const { rows: coa } = await pool.query(
  `SELECT code, name, account_type, account_group, sub_group, is_active, is_dynamic, dynamic_key, notes FROM account_codes`,
)
const byCode = new Map(coa.map(r => [String(r.code), r]))

// ── deed_accounts ────────────────────────────────────────────────────────────
const accounts = await readBlob('deed_accounts')
if (Array.isArray(accounts)) {
  let renumbered = 0
  const withNewCodes = accounts.map(a => {
    const code = String(a?.code ?? '').trim()
    const nextCode = RENUMBER[code]
    if (!nextCode) return a
    // Only renumber codes that no longer exist in the table. Codes like
    // 6201/6401/3305 are live again with their official meaning — a blob row
    // already on such a code is current, not stale.
    if (byCode.has(code)) return a
    renumbered++
    return {
      ...a,
      code: nextCode,
      id: String(a.id || '').startsWith('coa-') ? `coa-prisma-${nextCode}` : a.id,
    }
  })

  // A renumbered row can land on a code the blob already has — keep one row
  // per code (prefer the one whose name matches the table).
  const seen = new Map()
  for (const a of withNewCodes) {
    const code = String(a?.code ?? '').trim()
    const prev = seen.get(code)
    if (!prev) { seen.set(code, a); continue }
    const live = byCode.get(code)
    const prevMatch = live && prev.name === live.name
    const nextMatch = live && a.name === live.name
    seen.set(code, nextMatch && !prevMatch ? a : prev)
  }
  const deduped = [...seen.values()]

  let corrected = 0
  let removed = 0
  const next = deduped
    .filter(a => {
      const code = String(a?.code ?? '').trim()
      // The relational table is authoritative after the renumbering — blob
      // rows whose account was removed (superseded duplicates) drop out.
      if (code && !byCode.has(code)) { removed++; return false }
      return true
    })
    .map(a => {
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

  console.log(`deed_accounts: ${accounts.length} → ${next.length + additions.length} rows (renumbered ${renumbered}, corrected ${corrected}, removed ${removed}, added ${additions.length})`)
  if (!DRY) await writeBlob('deed_accounts', [...next, ...additions])
} else {
  console.log('deed_accounts blob not present — skipping account alignment.')
}

// ── deed_products ────────────────────────────────────────────────────────────
const products = await readBlob('deed_products')
if (Array.isArray(products)) {
  let touched = 0
  const nextProducts = products.map(p => {
    if (!p || typeof p !== 'object') return p
    const out = { ...p }
    let changed = false
    for (const field of PRODUCT_CODE_FIELDS) {
      const raw = String(out[field] ?? '').trim()
      if (!raw) continue
      let code = PRODUCT_RENUMBER[raw] ?? raw
      // Opening-stock grid codes must not be the live inventory asset account.
      if (field === 'inventoryAccountCode' && /^1[14-6]\d{2}$/.test(code)) code = '1200'
      // Services/software revenue moved off the product grid.
      if (field === 'saleAccountCode' && code === '5003') {
        const cat = String(out.category ?? '')
        code = cat === 'Services' ? '5101' : cat === 'Software & Licences' ? '5009' : code
      }
      if (!byCode.has(code)) {
        console.log(`  ! ${out.name || out.id}: ${field} ${raw} has no matching account — clearing`)
        code = ''
      }
      if (code !== raw) { out[field] = code; changed = true }
    }
    if (changed) touched++
    return changed ? out : p
  })
  console.log(`deed_products: ${touched} of ${products.length} products remapped`)
  if (!DRY && touched > 0) await writeBlob('deed_products', nextProducts)
} else {
  console.log('deed_products blob not present — skipping product remap.')
}

if (DRY) console.log('DRY RUN — nothing written.')
else console.log('Blob alignment complete.')
await pool.end()
