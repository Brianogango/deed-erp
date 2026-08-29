#!/usr/bin/env node
/**
 * Heal purchase_order_items.qty_received from validated blob receipts.
 *
 * GRNs were validated against blob PO ids; the Prisma PO items never got the
 * received quantities, so bill posting's 3-way match saw "received 0".
 * Recomputes qty_received per PO item from validated receipt lines.
 * Idempotent. Run --dry-run first.
 */
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

const { rows: stateRows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_receipts'`)
const receipts = stateRows.length
  ? JSON.parse(typeof stateRows[0].value === 'string' ? stateRows[0].value : JSON.stringify(stateRows[0].value))
  : []

// received qty per (poId, productId) from validated receipts
const received = new Map()
for (const r of receipts) {
  if (!r || r.status !== 'validated') continue
  const poId = String(r.poId ?? '')
  if (!poId) continue
  for (const line of Array.isArray(r.lines) ? r.lines : []) {
    const pid = String(line.productId ?? '')
    if (!pid) continue
    const key = `${poId}::${pid}`
    received.set(key, (received.get(key) || 0) + Math.max(0, Number(line.qtyReceived) || 0))
  }
}

const { rows: items } = await pool.query(
  `SELECT i.id, i.po_id, i.product_id, i.qty_ordered, i.qty_received, p.po_number FROM purchase_order_items i JOIN purchase_orders p ON p.id = i.po_id`,
)

let updated = 0
for (const item of items) {
  const key = `${item.po_id}::${item.product_id}`
  const qty = received.get(key)
  if (qty === undefined) continue
  const target = Math.min(Number(qty), Number(item.qty_ordered))
  if (!Number.isFinite(target)) continue
  if (Number(item.qty_received) === target) continue
  console.log(`${item.po_number}: item ${item.id.slice(0, 8)} qty_received ${item.qty_received} → ${target}`)
  if (!DRY) {
    await pool.query(`UPDATE purchase_order_items SET qty_received = $1 WHERE id = $2`, [target, item.id])
    updated++
  } else {
    updated++
  }
}

console.log(`qty_received healed on ${updated} PO item(s) from validated receipts`)
if (DRY) console.log('DRY RUN — nothing written.')
await pool.end()
