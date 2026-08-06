#!/usr/bin/env node
/**
 * Backfill inventory tables from blob SoT keys (dual-write cutover).
 *
 * Usage (on Contabo app host, after schema migration):
 *   cd /var/www/deed-erp && node scripts/backfill-inventory-to-prisma.mjs
 *
 * Safe to re-run. Never deletes blobs. Uses `pg` only (Prisma 7 adapter-safe).
 * Prefer order: serials → moves → POs → receipts → bulk.
 */
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { readFileSync } from 'fs'

const require = createRequire(import.meta.url)
const { Pool } = require('pg')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = readFileSync('.env', 'utf8')
  return env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
}

function uuidFromKey(namespace, key) {
  const h = createHash('md5').update(`${namespace}:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function asUuid(v) {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}

function asDate(v) {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

async function loadBlob(client, key) {
  const { rows } = await client.query(`SELECT value FROM app_state WHERE key = $1 LIMIT 1`, [key])
  if (!rows[0]?.value) return []
  const parsed = JSON.parse(rows[0].value)
  return Array.isArray(parsed) ? parsed : []
}

function mapPoStatus(raw) {
  const s = String(raw ?? 'draft').toLowerCase()
  if (s === 'draft') return 'draft'
  if (s === 'sent' || s === 'pending_approval') return 'pending_approval'
  if (s === 'confirmed' || s === 'approved') return 'approved'
  if (s === 'partial' || s === 'partially_received') return 'partially_received'
  if (s === 'received') return 'received'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'draft'
}

function mapMoveType(type, reason) {
  const t = String(type ?? '').toLowerCase()
  const r = String(reason ?? '').toLowerCase()
  if (r.includes('opening')) return 'opening_stock'
  if (t === 'in') return r.includes('adjust') ? 'adjustment_in' : 'purchase_receive'
  if (t === 'out') return r.includes('write') ? 'write_off' : 'sale'
  if (t === 'transfer') return 'transfer'
  if (t === 'return') return 'return_from_client'
  if (t === 'adjustment') return 'adjustment_in'
  return 'adjustment_in'
}

async function main() {
  const pool = new Pool({ connectionString: loadDbUrl() })
  const client = await pool.connect()
  const stats = {}
  try {
    const products = new Set((await client.query(`SELECT id::text FROM products`)).rows.map(r => r.id))
    const users = (await client.query(`SELECT id::text AS id FROM users ORDER BY created_at ASC`)).rows
    const fallbackUser = users[0]?.id
    if (!fallbackUser) throw new Error('No users in DB — cannot mirror POs/GRNs')

    // ── Serials ────────────────────────────────────────────────────────────
    const serials = await loadBlob(client, 'deed_serials')
    let ok = 0, fail = 0
    for (const r of serials) {
      const blobId = String(r?.id ?? '').trim()
      const serial = String(r?.serial ?? '').trim()
      const productId = asUuid(r.productId)
      if (!blobId || !serial || !productId || !products.has(productId)) { fail++; continue }
      try {
        const id = asUuid(blobId) ?? uuidFromKey('serial', blobId)
        const status = String(r.status ?? 'available').toLowerCase() === 'in_stock' ? 'available' : String(r.status ?? 'available').slice(0, 30)
        const barcode = String(r.barcode ?? serial).trim().slice(0, 120) || null
        const existing = await client.query(
          `SELECT id::text FROM serial_numbers WHERE blob_id = $1 OR id = $2::uuid OR serial_number = $3 LIMIT 1`,
          [blobId, id, serial.slice(0, 100)],
        )
        const params = [
          existing.rows[0]?.id ?? id, blobId, productId, serial.slice(0, 100), barcode,
          status, String(r.location ?? 'warehouse').slice(0, 30),
          r.productName ? String(r.productName).slice(0, 200) : null,
          asDate(r.receivedDate), asDate(r.soldDate),
          r.accessoryNotes ? String(r.accessoryNotes) : null,
        ]
        if (existing.rows[0]) {
          await client.query(
            `UPDATE serial_numbers SET blob_id=$2, product_id=$3::uuid, serial_number=$4, inventory_barcode=$5,
              status=$6, location=$7, product_name=$8, received_date=$9::date, sold_date=$10::date,
              notes=COALESCE($11, notes), updated_at=NOW() WHERE id=$1::uuid`,
            params,
          )
        } else {
          await client.query(
            `INSERT INTO serial_numbers (id, blob_id, product_id, serial_number, inventory_barcode, status, location, product_name, received_date, sold_date, notes, created_at, updated_at)
             VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9::date,$10::date,$11,NOW(),NOW())
             ON CONFLICT (serial_number) DO UPDATE SET blob_id=EXCLUDED.blob_id, location=EXCLUDED.location,
               status=EXCLUDED.status, product_id=EXCLUDED.product_id, inventory_barcode=COALESCE(EXCLUDED.inventory_barcode, serial_numbers.inventory_barcode),
               product_name=EXCLUDED.product_name, received_date=EXCLUDED.received_date, sold_date=EXCLUDED.sold_date, updated_at=NOW()`,
            params,
          )
        }
        ok++
      } catch (e) {
        fail++
        if (fail <= 5) console.error('serial fail', blobId, e.message)
      }
    }
    stats.serials = { ok, fail, blob: serials.length }

    // ── Stock moves ────────────────────────────────────────────────────────
    const moves = await loadBlob(client, 'deed_stockMoves')
    const serialRows = (await client.query(`SELECT id::text, serial_number FROM serial_numbers`)).rows
    const serialByNum = new Map(serialRows.map(s => [String(s.serial_number).toLowerCase(), s.id]))
    ok = 0; fail = 0
    for (const r of moves) {
      const blobId = String(r?.id ?? '').trim()
      const productId = asUuid(r.productId)
      if (!blobId || !productId || !products.has(productId)) { fail++; continue }
      try {
        const id = asUuid(blobId) ?? uuidFromKey('stock-move', blobId)
        const serialList = Array.isArray(r.serialNumbers) ? r.serialNumbers.map(String).filter(Boolean) : []
        let serialId = null
        for (const sn of serialList) {
          if (UUID_RE.test(sn) && serialByNum.has(sn)) { serialId = sn; break } // unlikely
          const hit = serialByNum.get(sn.toLowerCase())
          if (hit) { serialId = hit; break }
        }
        const existing = await client.query(
          `SELECT id::text FROM stock_movements WHERE blob_id=$1 OR id=$2::uuid LIMIT 1`,
          [blobId, id],
        )
        const qty = Math.max(0, Math.abs(Number(r.qty) || 0))
        const mtype = mapMoveType(r.type, r.reason)
        const createdBy = asUuid(r.userId) && users.some(u => u.id === r.userId) ? r.userId : null
        const params = [
          existing.rows[0]?.id ?? id, blobId, productId, serialId, mtype, qty,
          r.fromLocation ? String(r.fromLocation).slice(0, 40) : null,
          r.toLocation ? String(r.toLocation).slice(0, 40) : null,
          r.documentRef ? String(r.documentRef).slice(0, 80) : null,
          serialList, r.reason ? String(r.reason) : null, createdBy,
          asDate(r.date) || new Date().toISOString().slice(0, 10),
        ]
        if (existing.rows[0]) {
          await client.query(
            `UPDATE stock_movements SET blob_id=$2, product_id=$3::uuid, serial_number_id=$4::uuid,
              movement_type=$5::stock_movement_type, qty=$6, from_location=$7, to_location=$8,
              document_ref=$9, serial_numbers=$10::text[], notes=$11, created_by=$12::uuid
             WHERE id=$1::uuid`,
            params.slice(0, 12),
          )
        } else {
          await client.query(
            `INSERT INTO stock_movements (id, blob_id, product_id, serial_number_id, movement_type, qty, qty_before, qty_after,
              from_location, to_location, document_ref, serial_numbers, notes, created_by, created_at, reference_type)
             VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::stock_movement_type,$6,0,0,$7,$8,$9,$10::text[],$11,$12::uuid,$13::date,'blob_stock_move')`,
            params,
          )
        }
        ok++
      } catch (e) {
        fail++
        if (fail <= 5) console.error('move fail', blobId, e.message)
      }
    }
    stats.stockMoves = { ok, fail, blob: moves.length }

    // ── Purchase orders ────────────────────────────────────────────────────
    const pos = await loadBlob(client, 'deed_purchaseOrders')
    ok = 0; fail = 0
    for (const r of pos) {
      const blobId = String(r?.id ?? '').trim()
      const vendorId = asUuid(r.vendorId)
      if (!blobId || !vendorId) { fail++; continue }
      try {
        await client.query('BEGIN')
        const vendorName = String(r.vendorName || 'Vendor').slice(0, 200)
        const supplierNumber = `V-${vendorId.replace(/-/g, '').slice(0, 12)}`.slice(0, 20)
        // Ensure supplier outside fragile nested catch — use SAVEPOINT.
        await client.query('SAVEPOINT sp_supplier')
        try {
          await client.query(
            `INSERT INTO suppliers (id, supplier_number, name, is_active, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, true, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
            [vendorId, supplierNumber, vendorName],
          )
        } catch (supErr) {
          await client.query('ROLLBACK TO SAVEPOINT sp_supplier')
          const altNum = `V${vendorId.replace(/-/g, '').slice(0, 18)}`.slice(0, 20)
          await client.query(
            `INSERT INTO suppliers (id, supplier_number, name, is_active, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, true, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
            [vendorId, altNum, vendorName],
          )
        }
        await client.query('RELEASE SAVEPOINT sp_supplier')

        const id = asUuid(blobId) ?? uuidFromKey('po', blobId)
        const poNumber = String(r.ref || blobId).slice(0, 30)
        const existing = await client.query(
          `SELECT id::text FROM purchase_orders WHERE blob_id=$1 OR id=$2::uuid OR po_number=$3 LIMIT 1`,
          [blobId, id, poNumber],
        )
        const poId = existing.rows[0]?.id ?? id
        const header = [
          poId, blobId, poNumber, vendorId,
          r.vendorName ? String(r.vendorName).slice(0, 200) : null,
          mapPoStatus(r.status),
          asDate(r.date) || new Date().toISOString().slice(0, 10),
          asDate(r.expectedDate),
          Number(r.subtotal) || 0,
          Number(r.taxTotal ?? r.taxAmount) || 0,
          Number(r.total ?? r.totalAmount) || 0,
          r.notes ? String(r.notes) : null,
          fallbackUser,
        ]
        if (existing.rows[0]) {
          await client.query(
            `UPDATE purchase_orders SET blob_id=$2, po_number=$3, supplier_id=$4::uuid, vendor_name=$5,
              status=$6::purchase_order_status, order_date=$7::date, expected_date=$8::date,
              subtotal=$9, tax_amount=$10, total_amount=$11, notes=$12, updated_at=NOW()
             WHERE id=$1::uuid`,
            header.slice(0, 12),
          )
          // Do not delete PO items — GRN lines FK them. Upsert by id below.
        } else {
          await client.query(
            `INSERT INTO purchase_orders (id, blob_id, po_number, supplier_id, vendor_name, status, order_date, expected_date,
              subtotal, tax_amount, total_amount, notes, created_by, created_at, updated_at)
             VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6::purchase_order_status,$7::date,$8::date,$9,$10,$11,$12,$13::uuid,NOW(),NOW())`,
            header,
          )
        }
        const lines = Array.isArray(r.lines) ? r.lines : []
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx]
          const productId = asUuid(line.productId)
          if (!productId || !products.has(productId)) continue
          const lineId = asUuid(line.id) ?? uuidFromKey('po-item', `${blobId}:${idx}:${productId}`)
          const qty = Math.max(0, Number(line.qty) || 0)
          const unitCost = Number(line.unitPrice ?? line.unitCost ?? 0) || 0
          await client.query(
            `INSERT INTO purchase_order_items (id, po_id, product_id, description, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO UPDATE SET
               description=EXCLUDED.description, qty_ordered=EXCLUDED.qty_ordered,
               qty_received=EXCLUDED.qty_received, unit_cost=EXCLUDED.unit_cost,
               tax_rate=EXCLUDED.tax_rate, line_total=EXCLUDED.line_total`,
            [
              lineId, poId, productId,
              line.productName ? String(line.productName) : null,
              qty, Math.max(0, Number(line.qtyReceived) || 0), unitCost,
              Number(line.taxRate) || 0, Number(line.subtotal ?? qty * unitCost) || 0,
            ],
          )
        }
        await client.query('COMMIT')
        ok++
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        fail++
        if (fail <= 5) console.error('po fail', blobId, e.message)
      }
    }
    stats.purchaseOrders = { ok, fail, blob: pos.length }

    // ── Receipts / GRNs ────────────────────────────────────────────────────
    const receipts = await loadBlob(client, 'deed_receipts')
    const poRows = (await client.query(
      `SELECT id::text, blob_id FROM purchase_orders`,
    )).rows
    const poById = new Map(poRows.map(p => [p.id, p.id]))
    const poByBlob = new Map(poRows.filter(p => p.blob_id).map(p => [p.blob_id, p.id]))
    ok = 0; fail = 0
    for (const r of receipts) {
      const blobId = String(r?.id ?? '').trim()
      const poBlob = String(r.poId ?? '').trim()
      const poId = poById.get(poBlob) || poByBlob.get(poBlob)
      if (!blobId || !poId) { fail++; continue }
      try {
        await client.query('BEGIN')
        const id = asUuid(blobId) ?? uuidFromKey('grn', blobId)
        const grnNumber = String(r.ref || blobId).slice(0, 30)
        const existing = await client.query(
          `SELECT id::text FROM goods_received_notes WHERE blob_id=$1 OR id=$2::uuid OR grn_number=$3 LIMIT 1`,
          [blobId, id, grnNumber],
        )
        const grnId = existing.rows[0]?.id ?? id
        const header = [
          grnId, blobId, grnNumber, poId,
          asDate(r.date) || new Date().toISOString().slice(0, 10),
          String(r.destinationLocation ?? 'warehouse').slice(0, 40),
          String(r.status ?? 'draft').slice(0, 20),
          r.vendorName ? String(r.vendorName).slice(0, 200) : null,
          fallbackUser,
        ]
        if (existing.rows[0]) {
          await client.query(
            `UPDATE goods_received_notes SET blob_id=$2, grn_number=$3, po_id=$4::uuid, received_date=$5::date,
              destination_location=$6, status=$7, vendor_name=$8 WHERE id=$1::uuid`,
            header.slice(0, 8),
          )
          await client.query(`DELETE FROM grn_items WHERE grn_id=$1::uuid`, [grnId])
        } else {
          await client.query(
            `INSERT INTO goods_received_notes (id, blob_id, grn_number, po_id, received_date, destination_location, status, vendor_name, created_by)
             VALUES ($1::uuid,$2,$3,$4::uuid,$5::date,$6,$7,$8,$9::uuid)`,
            header,
          )
        }
        const poItems = (await client.query(
          `SELECT id::text, product_id::text FROM purchase_order_items WHERE po_id=$1::uuid`,
          [poId],
        )).rows
        const lines = Array.isArray(r.lines) ? r.lines : []
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx]
          const productId = asUuid(line.productId)
          if (!productId || !products.has(productId)) continue
          let poItemId = poItems.find(i => i.product_id === productId)?.id
          if (!poItemId) {
            poItemId = uuidFromKey('po-item', `${poId}:${productId}`)
            await client.query(
              `INSERT INTO purchase_order_items (id, po_id, product_id, description, qty_ordered, qty_received, unit_cost, tax_rate, line_total)
               VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,0,0,0)
               ON CONFLICT (id) DO NOTHING`,
              [
                poItemId, poId, productId,
                line.productName ? String(line.productName) : null,
                Math.max(1, Number(line.qtyExpected) || Number(line.qtyReceived) || 1),
                Math.max(0, Number(line.qtyReceived) || 0),
              ],
            )
            poItems.push({ id: poItemId, product_id: productId })
          }
          const serialsArr = Array.isArray(line.serials) ? line.serials.map(String).filter(Boolean) : []
          await client.query(
            `INSERT INTO grn_items (id, grn_id, po_item_id, product_id, product_name, qty_expected, qty_received, unit_cost, serial_numbers)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,0,$8::text[])`,
            [
              uuidFromKey('grn-item', `${blobId}:${idx}`), grnId, poItemId, productId,
              line.productName ? String(line.productName).slice(0, 200) : null,
              Math.max(0, Number(line.qtyExpected) || 0),
              Math.max(0, Number(line.qtyReceived) || 0),
              serialsArr,
            ],
          )
        }
        await client.query('COMMIT')
        ok++
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        fail++
        if (fail <= 5) console.error('grn fail', blobId, e.message)
      }
    }
    stats.receipts = { ok, fail, blob: receipts.length }

    // ── Bulk stock ─────────────────────────────────────────────────────────
    const bulk = await loadBlob(client, 'deed_bulkStock')
    ok = 0; fail = 0
    for (const r of bulk) {
      const productId = asUuid(r.productId)
      if (!productId || !products.has(productId)) { fail++; continue }
      const location = String(r.location ?? 'warehouse').slice(0, 30)
      const qty = Math.max(0, Number(r.qty) || 0)
      const id = uuidFromKey('bulk-stock', `${productId}:${location}`)
      try {
        await client.query(
          `INSERT INTO bulk_stock_levels (id, product_id, location, qty)
           VALUES ($1::uuid,$2::uuid,$3,$4)
           ON CONFLICT (product_id, location) DO UPDATE SET qty=EXCLUDED.qty, updated_at=NOW()`,
          [id, productId, location, qty],
        )
        ok++
      } catch (e) {
        fail++
        if (fail <= 5) console.error('bulk fail', productId, e.message)
      }
    }
    stats.bulkStock = { ok, fail, blob: bulk.length }

    // Final counts
    const counts = (await client.query(`SELECT
      (SELECT COUNT(*) FROM serial_numbers)::int AS serials,
      (SELECT COUNT(*) FROM stock_movements)::int AS moves,
      (SELECT COUNT(*) FROM purchase_orders)::int AS pos,
      (SELECT COUNT(*) FROM goods_received_notes)::int AS grns,
      (SELECT COUNT(*) FROM bulk_stock_levels)::int AS bulk,
      (SELECT COUNT(*) FROM suppliers)::int AS suppliers`)).rows[0]

    console.log(JSON.stringify({ stats, prisma: counts }, null, 2))
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
