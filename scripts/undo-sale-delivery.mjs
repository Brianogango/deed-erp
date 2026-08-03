#!/usr/bin/env node
/**
 * Ops helper: undo a sale delivery and return product to stock.
 *
 * For Done deliveries: restock serials/bulk/product qty, reverse SO qtyDelivered,
 * cancel the DN, cancel related reservations/warranties, write a stock return move.
 * For open deliveries (waiting/ready/draft): cancel only (no stock change).
 *
 *   node scripts/undo-sale-delivery.mjs --request ops/undo-sale-delivery-request.json
 *   node scripts/undo-sale-delivery.mjs --mode list --customer "Tica Health"
 *   node scripts/undo-sale-delivery.mjs --mode undo --customer "Tica Health" --cancel-open
 *   node scripts/undo-sale-delivery.mjs --mode undo --order SO/2026/0006 --delivery DN/2026/0014
 *   node scripts/undo-sale-delivery.mjs --mode undo --customer "Tica Health" --dry-run
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function isUuid(id) {
  return Boolean(id && UUID_RE.test(String(id)))
}

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function effectiveQty(line) {
  const demand = Math.max(0, Number(line?.qty) || 0)
  const fromDone = Math.max(0, Number(line?.qtyDone) || 0)
  const fromSerials = Array.isArray(line?.serialIds) ? line.serialIds.length : 0
  const raw = Math.max(fromDone, fromSerials)
  return demand > 0 ? Math.min(raw, demand) : raw
}

function deliveredTotal(delivery) {
  return (delivery?.lines ?? []).reduce((sum, line) => sum + effectiveQty(line), 0)
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

function upsertBulk(levels, productId, location, delta) {
  const loc = location || 'warehouse'
  const current = levels.find(l => l.productId === productId && l.location === loc)?.qty ?? 0
  const nextQty = Math.max(0, current + delta)
  const remaining = levels.filter(l => !(l.productId === productId && l.location === loc))
  return nextQty > 0 ? [...remaining, { productId, location: loc, qty: nextQty }] : remaining
}

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

const requestPath = String(arg('--request', '')).trim()
let cfg = {
  mode: String(arg('--mode', 'list')).trim().toLowerCase(),
  customer: String(arg('--customer', '')).trim(),
  order: String(arg('--order', '')).trim(),
  delivery: String(arg('--delivery', '')).trim(),
  cancelOpen: process.argv.includes('--cancel-open'),
  force: process.argv.includes('--force'),
  dryRun: process.argv.includes('--dry-run'),
}

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    fail(`Invalid JSON in ${abs}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (parsed.mode) cfg.mode = String(parsed.mode).trim().toLowerCase()
  if (parsed.customer) cfg.customer = String(parsed.customer).trim()
  if (parsed.order) cfg.order = String(parsed.order).trim()
  if (parsed.delivery) cfg.delivery = String(parsed.delivery).trim()
  if (parsed.cancelOpen === true) cfg.cancelOpen = true
  if (parsed.force === true) cfg.force = true
  if (parsed.dryRun === true) cfg.dryRun = true
}

if (!['list', 'undo'].includes(cfg.mode)) fail('mode must be list or undo')
if (!cfg.customer && !cfg.order && !cfg.delivery) {
  fail('Pass --customer and/or --order and/or --delivery (or via --request)')
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!connectionString) fail('DATABASE_URL is not set')

const pool = new Pool({ connectionString })

function matchesDelivery(d, cfg) {
  if (cfg.delivery && d?.ref !== cfg.delivery) return false
  if (cfg.order) {
    const soMatch =
      d?.saleOrderRef === cfg.order ||
      d?.orderNumber === cfg.order ||
      d?.saleOrderId === cfg.order
    if (!soMatch) return false
  }
  if (cfg.customer) {
    const needle = norm(cfg.customer)
    const hay = norm(d?.customerName)
    if (!hay.includes(needle) && needle !== hay) return false
  }
  return true
}

function printDelivery(d) {
  const total = deliveredTotal(d)
  console.log(
    `  ${d.ref}  status=${d.status}  SO=${d.saleOrderRef ?? d.saleOrderId}  customer=${d.customerName ?? '?'}  delivered=${total}` +
      (d.backorderOfRef ? `  backorderOf=${d.backorderOfRef}` : '') +
      (d.deliveryNoteGeneratedAt ? '  DN-generated' : ''),
  )
  for (const line of d.lines ?? []) {
    const qty = effectiveQty(line)
    const serials = Array.isArray(line.serialIds) ? line.serialIds.length : 0
    console.log(
      `    - ${line.productName ?? line.productId}: demand=${line.qty} done=${line.qtyDone ?? 0}` +
        ` effective=${qty} serials=${serials} loc=${line.sourceLocation ?? 'warehouse'}`,
    )
  }
}

async function main() {
  const client = await pool.connect()
  try {
    const [
      deliveries,
      saleOrders,
      products,
      serials,
      bulkStock,
      stockMoves,
      stockReservations,
      warranties,
      invoices,
    ] = await Promise.all([
      loadJsonArray(client, 'deed_deliveries'),
      loadJsonArray(client, 'deed_saleOrders'),
      loadJsonArray(client, 'deed_products'),
      loadJsonArray(client, 'deed_serials'),
      loadJsonArray(client, 'deed_bulkStock'),
      loadJsonArray(client, 'deed_stockMoves'),
      loadJsonArray(client, 'deed_stockReservations'),
      loadJsonArray(client, 'deed_warranties'),
      loadJsonArray(client, 'deed_invoices'),
    ])

    let targets = deliveries.filter(d => matchesDelivery(d, cfg) && d?.status !== 'cancelled')

    // If customer filter only, also include SOs for that customer and their DNs.
    if (cfg.customer && !cfg.delivery) {
      const needle = norm(cfg.customer)
      const soIds = new Set(
        saleOrders
          .filter(so => norm(so?.customerName).includes(needle) || norm(so?.partnerName).includes(needle))
          .map(so => so.id),
      )
      if (cfg.order) {
        const so = saleOrders.find(
          o => o?.ref === cfg.order || o?.orderNumber === cfg.order || o?.id === cfg.order,
        )
        if (so) soIds.add(so.id)
      }
      const bySo = deliveries.filter(
        d =>
          d?.status !== 'cancelled' &&
          (soIds.has(d?.saleOrderId) ||
            matchesDelivery(d, { ...cfg, customer: cfg.customer })),
      )
      const seen = new Set(targets.map(d => d.id))
      for (const d of bySo) {
        if (!seen.has(d.id)) {
          targets.push(d)
          seen.add(d.id)
        }
      }
      if (cfg.order) {
        targets = targets.filter(
          d => d?.saleOrderRef === cfg.order || d?.saleOrderId === cfg.order || d?.saleOrderId === saleOrders.find(o => o.ref === cfg.order || o.orderNumber === cfg.order)?.id,
        )
      }
    }

    targets.sort((a, b) => String(a.ref).localeCompare(String(b.ref)))

    console.log(
      `Filter: mode=${cfg.mode} customer=${cfg.customer || '-'} order=${cfg.order || '-'} delivery=${cfg.delivery || '-'} cancelOpen=${cfg.cancelOpen} force=${cfg.force} dryRun=${cfg.dryRun}`,
    )
    console.log(`Matched ${targets.length} non-cancelled delivery(ies):`)
    for (const d of targets) printDelivery(d)

    if (targets.length === 0) {
      console.log('Nothing matched — no changes')
      return
    }

    if (cfg.mode === 'list') {
      // Also show SO qtyDelivered snapshot
      const soRefs = [...new Set(targets.map(d => d.saleOrderRef || d.saleOrderId).filter(Boolean))]
      for (const ref of soRefs) {
        const so = saleOrders.find(o => o.ref === ref || o.orderNumber === ref || o.id === ref)
        if (!so) continue
        console.log(`SO ${so.ref ?? so.orderNumber} status=${so.status}`)
        for (const line of so.lines ?? []) {
          console.log(
            `  line ${line.productName ?? line.productId}: qty=${line.qty} delivered=${line.qtyDelivered ?? 0} invoiced=${line.qtyInvoiced ?? 0}`,
          )
        }
        const invs = invoices.filter(
          inv =>
            inv?.saleOrderId === so.id &&
            String(inv?.status ?? '') !== 'cancelled' &&
            String(inv?.type ?? '') === 'customer_invoice',
        )
        if (invs.length) {
          console.log(
            `  invoices: ${invs.map(i => `${i.ref}(${i.status})`).join(', ')}`,
          )
        }
      }
      console.log('OK: list only — no changes written')
      return
    }

    // ── undo ──────────────────────────────────────────────────────────────
    const doneTargets = targets.filter(d => d.status === 'done')
    const openTargets = targets.filter(d => ['draft', 'waiting', 'ready'].includes(d.status))

    // Invoice guard: block undo of Done if SO has a non-cancelled customer invoice
    // unless --force (draft invoices still warn but allow with force only for posted).
    for (const del of doneTargets) {
      const so = saleOrders.find(o => o.id === del.saleOrderId || o.ref === del.saleOrderRef)
      const invs = invoices.filter(
        inv =>
          inv?.saleOrderId === (so?.id ?? del.saleOrderId) &&
          String(inv?.status ?? '') !== 'cancelled' &&
          (String(inv?.type ?? '') === 'customer_invoice' || !inv?.type),
      )
      const posted = invs.filter(i => ['posted', 'paid', 'partial', 'overdue'].includes(String(i.status)))
      if (posted.length && !cfg.force) {
        fail(
          `${del.ref}: SO has posted invoice(s) ${posted.map(i => i.ref).join(', ')}. ` +
            `Pass force:true / --force to undo anyway (finance may need a credit note).`,
        )
      }
      if (invs.length && !posted.length) {
        console.log(
          `WARNING: ${del.ref} SO has draft/open invoice(s) ${invs.map(i => `${i.ref}(${i.status})`).join(', ')} — continuing (qtyDelivered will drop; invoice may need review)`,
        )
      }
    }

    // Cancel Done targets after restock; cancel open when --cancel-open, when a
    // specific delivery is targeted, or when scoping by customer/order (clean slate).
    const cancelSet = new Map()
    for (const d of doneTargets) cancelSet.set(d.id, d)
    const shouldCancelOpen =
      cfg.cancelOpen || Boolean(cfg.delivery) || Boolean(cfg.customer) || Boolean(cfg.order)
    if (shouldCancelOpen) {
      for (const d of openTargets) cancelSet.set(d.id, d)
    }
    // Also cancel open backorders of undone Done DNs
    for (const done of doneTargets) {
      for (const d of deliveries) {
        if (d.status === 'cancelled') continue
        if (d.backorderOfId === done.id || d.backorderOfRef === done.ref) {
          if (['draft', 'waiting', 'ready'].includes(d.status)) cancelSet.set(d.id, d)
        }
      }
    }

    console.log(
      `Will undo Done=${doneTargets.map(d => d.ref).join(', ') || '(none)'}; ` +
        `cancel=${[...cancelSet.values()].map(d => `${d.ref}(${d.status})`).join(', ') || '(none)'}`,
    )

    if (cfg.dryRun) {
      console.log('[dry-run] No writes')
      return
    }

    let nextProducts = products.map(p => ({ ...p }))
    let nextSerials = serials.map(s => ({ ...s }))
    let nextBulk = bulkStock.map(b => ({ ...b }))
    let nextMoves = [...stockMoves]
    let nextReservations = stockReservations.map(r => ({ ...r }))
    let nextWarranties = warranties.map(w => ({ ...w }))
    let nextSaleOrders = saleOrders.map(o => ({ ...o }))
    const nextDeliveries = deliveries.map(d => ({ ...d }))
    const prismaStockDeltas = new Map()
    const prismaSerialIds = []
    const prismaSerialLabels = []
    const soDeliveredDelta = new Map() // soId -> productId -> qty to subtract

    const date = todayLocal()

    for (const done of doneTargets) {
      const delIdx = nextDeliveries.findIndex(d => d.id === done.id)
      if (delIdx < 0) continue
      const del = nextDeliveries[delIdx]
      const soId = del.saleOrderId
      if (!soDeliveredDelta.has(soId)) soDeliveredDelta.set(soId, new Map())
      const prodMap = soDeliveredDelta.get(soId)

      for (const line of del.lines ?? []) {
        const qty = effectiveQty(line)
        if (qty <= 0) continue
        const productId = String(line.productId ?? '')
        if (!productId) continue
        const product = nextProducts.find(p => p.id === productId)
        if (product?.unit === 'service') continue

        const location = line.sourceLocation || 'warehouse'
        const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []
        const serialLabels = []

        for (const sid of serialIds) {
          const sIdx = nextSerials.findIndex(s => s.id === sid)
          if (sIdx < 0) {
            console.log(`  WARNING: serial id ${sid} not found in deed_serials`)
            continue
          }
          const s = nextSerials[sIdx]
          serialLabels.push(s.serial ?? sid)
          nextSerials[sIdx] = {
            ...s,
            status: 'available',
            location,
            soldDate: undefined,
            saleOrderId: undefined,
            deliveryId: undefined,
          }
          delete nextSerials[sIdx].soldDate
          delete nextSerials[sIdx].saleOrderId
          delete nextSerials[sIdx].deliveryId
          if (isUuid(sid)) prismaSerialIds.push(sid)
          if (s.serial) prismaSerialLabels.push(String(s.serial))
        }

        const requiresSerial = Boolean(product?.requiresSerial) || serialIds.length > 0
        if (!requiresSerial) {
          nextBulk = upsertBulk(nextBulk, productId, location, qty)
        }

        const pIdx = nextProducts.findIndex(p => p.id === productId)
        if (pIdx >= 0) {
          nextProducts[pIdx] = {
            ...nextProducts[pIdx],
            stockQty: Math.max(0, (Number(nextProducts[pIdx].stockQty) || 0) + qty),
          }
        }

        if (isUuid(productId)) {
          prismaStockDeltas.set(productId, (prismaStockDeltas.get(productId) ?? 0) + qty)
        }

        prodMap.set(productId, (prodMap.get(productId) ?? 0) + qty)

        nextMoves = [
          {
            id: randomUUID(),
            type: 'return',
            productId,
            productName: line.productName || product?.name || 'Item',
            qty,
            reason: `Undo delivery ${del.ref} — return to stock`,
            fromLocation: 'customer',
            toLocation: location,
            serialNumbers: serialLabels,
            date,
            userId: 'system',
            documentRef: del.ref,
          },
          ...nextMoves,
        ]

        console.log(
          `  Restock ${del.ref}: ${line.productName ?? productId} +${qty}` +
            (serialLabels.length ? ` serials=[${serialLabels.join(', ')}]` : ` loc=${location}`),
        )
      }

      // Cancel warranties created from this delivery
      nextWarranties = nextWarranties.map(w => {
        if (w.deliveryId === del.id || (w.saleOrderRef === del.saleOrderRef && w.deliveryId === del.id)) {
          if (w.status === 'active' || w.status === 'pending') {
            console.log(`  Cancel warranty ${w.ref ?? w.id} for ${del.ref}`)
            return { ...w, status: 'cancelled', notes: `${w.notes ?? ''} · cancelled with undo ${del.ref}`.trim() }
          }
        }
        if (w.deliveryId === del.id && w.status !== 'cancelled') {
          return { ...w, status: 'cancelled', notes: `${w.notes ?? ''} · cancelled with undo ${del.ref}`.trim() }
        }
        return w
      })
    }

    // Cancel deliveries in cancelSet
    for (const [id, src] of cancelSet) {
      const idx = nextDeliveries.findIndex(d => d.id === id)
      if (idx < 0) continue
      const was = nextDeliveries[idx].status
      nextDeliveries[idx] = {
        ...nextDeliveries[idx],
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelReason: `Ops undo-sale-delivery (${was})`,
        deliveryNoteGeneratedAt: undefined,
        deliveryNoteGeneratedByUserId: undefined,
      }
      delete nextDeliveries[idx].deliveryNoteGeneratedAt
      delete nextDeliveries[idx].deliveryNoteGeneratedByUserId
      console.log(`  Cancel DN ${nextDeliveries[idx].ref}: ${was} → cancelled`)

      nextReservations = nextReservations.map(r => {
        if (r.deliveryId === id && (r.status === 'reserved' || r.status === 'fulfilled')) {
          return {
            ...r,
            status: 'cancelled',
            notes: `${r.notes ?? ''} · cancelled with undo ${src.ref}`.trim(),
          }
        }
        return r
      })
    }

    // Reduce SO qtyDelivered (blob + Prisma)
    for (const [soId, prodMap] of soDeliveredDelta) {
      const soIdx = nextSaleOrders.findIndex(o => o.id === soId)
      if (soIdx >= 0) {
        nextSaleOrders[soIdx] = {
          ...nextSaleOrders[soIdx],
          lines: (nextSaleOrders[soIdx].lines ?? []).map(line => {
            const sub = prodMap.get(line.productId) ?? 0
            if (sub <= 0) return line
            const next = Math.max(0, (Number(line.qtyDelivered) || 0) - sub)
            console.log(
              `  SO ${nextSaleOrders[soIdx].ref} line ${line.productName ?? line.productId}: qtyDelivered ${line.qtyDelivered ?? 0} → ${next}`,
            )
            return { ...line, qtyDelivered: next }
          }),
        }
      }

      // Prisma sale_order_items
      try {
        const items = await client.query(
          `SELECT id, product_id, description, qty_delivered FROM sale_order_items WHERE sale_order_id = $1`,
          [soId],
        )
        for (const item of items.rows) {
          const pid = item.product_id
          const sub = pid ? (prodMap.get(pid) ?? 0) : 0
          if (sub <= 0) continue
          const next = Math.max(0, (Number(item.qty_delivered) || 0) - sub)
          await client.query(`UPDATE sale_order_items SET qty_delivered = $1 WHERE id = $2`, [next, item.id])
          console.log(
            `  Prisma SO item ${item.description}: qty_delivered ${item.qty_delivered} → ${next}`,
          )
        }
      } catch (err) {
        console.log(
          `Note: Prisma sale_order_items update skipped (${err instanceof Error ? err.message : String(err)})`,
        )
      }
    }

    await client.query('BEGIN')
    try {
      await saveJsonArray(client, 'deed_deliveries', nextDeliveries)
      await saveJsonArray(client, 'deed_saleOrders', nextSaleOrders)
      await saveJsonArray(client, 'deed_products', nextProducts)
      await saveJsonArray(client, 'deed_serials', nextSerials)
      await saveJsonArray(client, 'deed_bulkStock', nextBulk)
      await saveJsonArray(client, 'deed_stockMoves', nextMoves)
      await saveJsonArray(client, 'deed_stockReservations', nextReservations)
      await saveJsonArray(client, 'deed_warranties', nextWarranties)

      for (const [productId, delta] of prismaStockDeltas) {
        if (delta === 0) continue
        const exists = await client.query(`SELECT id FROM products WHERE id = $1::uuid`, [productId]).catch(() => ({ rows: [] }))
        if (!exists.rows[0]) {
          console.log(`Note: skip stock_levels for non-Prisma id ${productId}`)
          continue
        }
        const level = await client.query(
          `SELECT id, qty_on_hand FROM stock_levels WHERE product_id = $1::uuid`,
          [productId],
        )
        if (level.rows[0]) {
          await client.query(
            `UPDATE stock_levels
             SET qty_on_hand = GREATEST(0, qty_on_hand + $2), updated_at = NOW()
             WHERE product_id = $1::uuid`,
            [productId, delta],
          )
        } else {
          await client.query(
            `INSERT INTO stock_levels (id, product_id, qty_on_hand, qty_reserved, qty_on_order, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, 0, 0, NOW())
             ON CONFLICT (product_id) DO UPDATE
             SET qty_on_hand = GREATEST(0, stock_levels.qty_on_hand + EXCLUDED.qty_on_hand),
                 updated_at = NOW()`,
            [randomUUID(), productId, delta],
          )
        }
        console.log(`  Prisma stock_levels ${productId}: +${delta}`)
      }

      if (prismaSerialIds.length || prismaSerialLabels.length) {
        try {
          let updated = { rowCount: 0 }
          if (prismaSerialIds.length) {
            updated = await client.query(
              `UPDATE serial_numbers
               SET status = 'in_stock', sold_via_invoice_id = NULL, updated_at = NOW()
               WHERE id = ANY($1::uuid[])`,
              [prismaSerialIds],
            )
          }
          if (prismaSerialLabels.length) {
            const byLabel = await client.query(
              `UPDATE serial_numbers
               SET status = 'in_stock', sold_via_invoice_id = NULL, updated_at = NOW()
               WHERE lower(serial_number) = ANY($1::text[])`,
              [prismaSerialLabels.map(s => s.toLowerCase())],
            )
            updated = { rowCount: (updated.rowCount || 0) + (byLabel.rowCount || 0) }
          }
          console.log(`Prisma serial_numbers restored: ${updated.rowCount}`)
        } catch (err) {
          console.log(
            `Note: Prisma serial_numbers update skipped (${err instanceof Error ? err.message : String(err)})`,
          )
        }
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    console.log(
      `OK: undone ${doneTargets.length} Done DN(s), cancelled ${cancelSet.size} DN(s), stock returned.`,
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
