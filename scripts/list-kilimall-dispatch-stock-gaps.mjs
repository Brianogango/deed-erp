#!/usr/bin/env node
/**
 * READ-ONLY. Lists Kilimall dispatches made before dispatch took stock out on the
 * server: the serial was flagged sold, but no stock move exists for the order, so the
 * product's on-hand was never reduced.
 *
 *   node scripts/list-kilimall-dispatch-stock-gaps.mjs
 *
 * It changes nothing. Review the output, then decide how to correct the counts.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['.env', '.env.local']) {
  const p = resolve(ROOT, f)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.indexOf('=') <= 0) continue
    const k = t.slice(0, t.indexOf('=')).trim()
    let v = t.slice(t.indexOf('=') + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL is not set'); process.exit(1) }

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const read = async key => {
  const { rows } = await pool.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows[0]) return []
  const v = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value
  return Array.isArray(v) ? v : []
}

try {
  const [dispatches, orders, products, serials, moves] = await Promise.all([
    read('deed_kilimallDispatches'), read('deed_kilimallOrders'), read('deed_products'),
    read('deed_serials'), read('deed_stockMoves'),
  ])
  const orderById = new Map(orders.map(o => [o.id, o]))
  const productById = new Map(products.map(p => [p.id, p]))
  const serialById = new Map(serials.map(s => [s.id, s]))
  const moveRefs = new Set(moves.map(m => String(m.documentRef || '')))
  const moveSerials = new Set(moves.flatMap(m => Array.isArray(m.serialNumbers) ? m.serialNumbers.map(String) : []))

  const gaps = dispatches
    .filter(d => d.status === 'dispatched')
    .filter(d => {
      const order = orderById.get(d.orderId)
      return !moveRefs.has(String(order?.ref || d.orderRef || '')) && !moveSerials.has(String(d.serialNumber))
    })

  console.log(`Kilimall dispatches: ${dispatches.length}; without a stock move: ${gaps.length}\n`)
  const perProduct = new Map()
  for (const d of gaps) {
    const p = productById.get(d.productId)
    const s = serialById.get(d.serialId)
    console.log(`${d.ref}  order ${d.orderRef || d.orderId}  ${d.dispatchDate || d.date || ''}  ${d.productName}  serial ${d.serialNumber}  serial status: ${s?.status ?? 'missing'}`)
    const row = perProduct.get(d.productId) || { name: d.productName, units: 0, stockQty: p?.stockQty }
    row.units += 1
    perProduct.set(d.productId, row)
  }
  console.log('\nPer affected product (the serial register is the truth for serial-tracked items):')
  const uuid = /^[0-9a-f-]{36}$/i
  for (const [id, r] of perProduct) {
    const mine = serials.filter(x => x.productId === id)
    const count = st => mine.filter(x => String(x.status || '').toLowerCase() === st).length
    const available = mine.filter(x => ['available', 'in_stock'].includes(String(x.status || '').toLowerCase()))
    const atWarehouse = available.filter(x => String(x.location || '') === 'warehouse').length
    let prismaQty = 'n/a'
    if (uuid.test(id)) {
      const { rows } = await pool.query('SELECT qty_on_hand FROM stock_levels WHERE product_id = $1::uuid', [id])
      prismaQty = rows[0] ? String(rows[0].qty_on_hand) : 'no row'
    }
    console.log(`  ${r.name}\n    app stockQty: ${r.stockQty ?? '?'}   database qty_on_hand: ${prismaQty}   serials: available ${available.length} (${atWarehouse} at warehouse), sold ${count('sold')}, total ${mine.length}   gap units: ${r.units}   [${id}]`)
  }
  const stillAvailable = gaps.filter(d => ['available', 'in_stock'].includes(String(serialById.get(d.serialId)?.status || '').toLowerCase()))
  if (stillAvailable.length) {
    console.log('\nCHECK: these dispatches are recorded but their serial is still AVAILABLE (not sold):')
    for (const d of stillAvailable) console.log(`  ${d.ref} order ${d.orderRef || d.orderId} serial ${d.serialNumber}`)
  }
  const refCount = new Map()
  for (const d of dispatches) refCount.set(d.ref, (refCount.get(d.ref) || 0) + 1)
  const dup = [...refCount].filter(([, n]) => n > 1)
  if (dup.length) console.log(`\nNOTE: ${dup.length} dispatch reference(s) are used more than once: ${dup.map(([r, n]) => `${r} x${n}`).join(', ')}`)
  console.log('\nRead-only: nothing was changed.')
} finally {
  await pool.end()
}
