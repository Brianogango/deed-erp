#!/usr/bin/env node
/**
 * Ops helper: heal SO qty_delivered + delivery line qtyDone when a Done DN
 * has serials (or qtyDone) but Prisma / store left Delivered=0.
 *
 *   node scripts/heal-delivery-qty.mjs --order SO/2026/0007
 *   node scripts/heal-delivery-qty.mjs --order SO/2026/0007 --delivery DN/2026/0008
 *   node scripts/heal-delivery-qty.mjs --order SO/2026/0007 --dry-run
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
loadEnvFile(resolve(ROOT, '.env.local'))

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function effectiveQty(line) {
  const demand = Math.max(0, Number(line?.qty) || 0)
  const fromDone = Math.max(0, Number(line?.qtyDone) || 0)
  const fromSerials = Array.isArray(line?.serialIds) ? line.serialIds.length : 0
  return Math.max(0, Math.min(Math.max(fromDone, fromSerials), demand || Math.max(fromDone, fromSerials)))
}

const orderRef = String(arg('--order', '')).trim()
const deliveryRef = String(arg('--delivery', '')).trim()
const dryRun = process.argv.includes('--dry-run')

if (!orderRef) fail('Pass --order SO/YYYY/NNNN')

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!connectionString) fail('DATABASE_URL is not set')

const pool = new Pool({ connectionString })

async function loadJsonArray(client, key) {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows.length) return []
  try {
    const parsed = JSON.parse(rows[0].value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveJsonArray(client, key, value) {
  const payload = JSON.stringify(value)
  const updatedAt = new Date().toISOString()
  await client.query(
    `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, payload, updatedAt],
  )
}

async function main() {
  const client = await pool.connect()
  try {
    const soRows = await client.query(
      `SELECT id, order_number, status FROM sale_orders WHERE order_number = $1 LIMIT 1`,
      [orderRef],
    )
    if (!soRows.rows[0]) fail(`Sale order ${orderRef} not found`)
    const soId = soRows.rows[0].id
    console.log(`Found SO ${orderRef} id=${soId} status=${soRows.rows[0].status}`)

    const items = await client.query(
      `SELECT id, product_id, description, qty, qty_delivered, qty_invoiced, serial_number_id
       FROM sale_order_items WHERE sale_order_id = $1`,
      [soId],
    )
    console.log(`SO lines: ${items.rows.length}`)

    const deliveries = await loadJsonArray(client, 'deed_deliveries')
    const orderDeliveries = deliveries.filter(d =>
      d?.saleOrderId === soId || d?.saleOrderRef === orderRef,
    )
    const targetDeliveries = deliveryRef
      ? orderDeliveries.filter(d => d?.ref === deliveryRef)
      : orderDeliveries.filter(d => d?.status === 'done')

    if (deliveryRef && targetDeliveries.length === 0) {
      fail(`Delivery ${deliveryRef} not found for ${orderRef}`)
    }

    const deliveredByProduct = {}
    for (const del of targetDeliveries) {
      console.log(`Delivery ${del.ref} status=${del.status} lines=${(del.lines ?? []).length}`)
      for (const line of del.lines ?? []) {
        const qty = effectiveQty(line)
        const nextQtyDone = Math.max(Number(line.qtyDone) || 0, qty)
        if (nextQtyDone !== (Number(line.qtyDone) || 0)) {
          console.log(`  heal delivery line ${line.productName ?? line.productId}: qtyDone ${line.qtyDone ?? 0} → ${nextQtyDone}`)
          line.qtyDone = nextQtyDone
        }
        if (!line.productId || qty <= 0) continue
        deliveredByProduct[line.productId] = (deliveredByProduct[line.productId] ?? 0) + qty
      }
    }

    // Also count Prisma serial_number_id as 1 delivered unit when present.
    for (const item of items.rows) {
      if (item.serial_number_id && item.product_id) {
        deliveredByProduct[item.product_id] = Math.max(
          deliveredByProduct[item.product_id] ?? 0,
          1,
        )
      }
    }

    let prismaUpdates = 0
    for (const item of items.rows) {
      const demand = Number(item.qty) || 0
      const current = Number(item.qty_delivered) || 0
      const fromMap = item.product_id ? (deliveredByProduct[item.product_id] ?? 0) : 0
      const healed = Math.min(demand, Math.max(current, fromMap))
      console.log(
        `  line ${item.description}: qty=${demand} delivered=${current} → ${healed}` +
          (item.serial_number_id ? ` (serial ${item.serial_number_id})` : ''),
      )
      if (healed > current) {
        prismaUpdates += 1
        if (!dryRun) {
          await client.query(
            `UPDATE sale_order_items SET qty_delivered = $1 WHERE id = $2`,
            [healed, item.id],
          )
        }
      }
    }

    // Mirror into deed_saleOrders + write healed deliveries
    const saleOrders = await loadJsonArray(client, 'deed_saleOrders')
    let soUpdated = false
    const nextSaleOrders = saleOrders.map(order => {
      if (order?.id !== soId && order?.ref !== orderRef && order?.orderNumber !== orderRef) return order
      soUpdated = true
      const lines = (order.lines ?? []).map(line => {
        const fromMap = line.productId ? (deliveredByProduct[line.productId] ?? 0) : 0
        const serialCount = Array.isArray(line.serialIds) ? line.serialIds.length : 0
        const healed = Math.min(
          Number(line.qty) || 0,
          Math.max(Number(line.qtyDelivered) || 0, fromMap, serialCount),
        )
        return healed === (Number(line.qtyDelivered) || 0) ? line : { ...line, qtyDelivered: healed }
      })
      return { ...order, lines }
    })

    if (dryRun) {
      console.log(`[dry-run] Would update ${prismaUpdates} Prisma line(s); SO blob ${soUpdated ? 'yes' : 'no'}; deliveries ${targetDeliveries.length}`)
      return
    }

    if (soUpdated) await saveJsonArray(client, 'deed_saleOrders', nextSaleOrders)
    await saveJsonArray(client, 'deed_deliveries', deliveries)
    console.log(`OK: healed ${prismaUpdates} Prisma line(s); saleOrders blob=${soUpdated}; deliveries saved`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
