#!/usr/bin/env node
/**
 * Backfill delivery_notes from deed_deliveries blob (dual-write cutover).
 *
 * Usage (on Contabo app host):
 *   cd /var/www/deed-erp && node scripts/backfill-deliveries-to-prisma.mjs
 *
 * Safe to re-run (upsert by blob_id). Never deletes the blob.
 * Uses `pg` only (no PrismaClient adapter) so it runs under production Node.
 */
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env' })

const require = createRequire(import.meta.url)
const { Pool } = require('pg')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uuidFromKey(namespace, key) {
  const h = createHash('md5').update(`${namespace}:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function asUuid(v) {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT value FROM app_state WHERE key = 'deed_deliveries' LIMIT 1`,
    )
    const raw = rows[0]?.value
    if (!raw) {
      console.log('No deed_deliveries blob found')
      return
    }
    const deliveries = JSON.parse(raw)
    if (!Array.isArray(deliveries)) {
      throw new Error('deed_deliveries is not an array')
    }

    console.log(`Backfilling ${deliveries.length} deliveries…`)

    const products = new Set(
      (await client.query(`SELECT id::text FROM products`)).rows.map(r => r.id),
    )
    const clients = new Set(
      (await client.query(`SELECT id::text FROM clients`)).rows.map(r => r.id),
    )
    const saleOrders = new Set(
      (await client.query(`SELECT id::text FROM sale_orders`)).rows.map(r => r.id),
    )
    const users = new Set(
      (await client.query(`SELECT id::text FROM users`)).rows.map(r => r.id),
    )
    const serials = new Set(
      (await client.query(`SELECT id::text FROM serial_numbers`)).rows.map(r => r.id),
    )

    let ok = 0
    let fail = 0
    for (const r of deliveries) {
      const blobId = String(r?.id ?? '').trim()
      if (!blobId) continue
      try {
        await client.query('BEGIN')
        const saleOrderId = asUuid(r.saleOrderId) && saleOrders.has(r.saleOrderId) ? r.saleOrderId : null
        const clientId = asUuid(r.customerId) && clients.has(r.customerId) ? r.customerId : null
        const preparedBy =
          asUuid(r.preparedByUserId) && users.has(r.preparedByUserId) ? r.preparedByUserId : null
        const id = UUID_RE.test(blobId) ? blobId : uuidFromKey('delivery', blobId)
        const lines = Array.isArray(r.lines) ? r.lines : []

        const existing = await client.query(
          `SELECT id::text AS id FROM delivery_notes WHERE blob_id = $1 OR id = $2::uuid LIMIT 1`,
          [blobId, id],
        )
        const dnId = existing.rows[0]?.id ?? id

        if (existing.rows[0]) {
          await client.query(
            `UPDATE delivery_notes SET
              blob_id = $2, dn_number = $3, sale_order_id = $4::uuid, client_id = $5::uuid,
              sale_order_ref = $6, customer_name = $7, status = $8,
              delivery_date = $9::date, delivery_address = $10,
              recipient_name = $11, recipient_phone = $12, recipient_id_number = $13,
              notes = $14, warranty_created = $15,
              prepared_at = $16::timestamptz, prepared_by = $17::uuid, created_by = $17::uuid,
              updated_at = NOW()
             WHERE id = $1::uuid`,
            [
              dnId, blobId, String(r.ref || blobId).slice(0, 30), saleOrderId, clientId,
              r.saleOrderRef ? String(r.saleOrderRef).slice(0, 40) : null,
              r.customerName ? String(r.customerName).slice(0, 200) : null,
              String(r.status || 'waiting').slice(0, 30),
              r.date || null, r.deliveryAddress || null,
              r.recipientName ? String(r.recipientName).slice(0, 150) : null,
              r.recipientPhone ? String(r.recipientPhone).slice(0, 20) : null,
              r.recipientIdNumber ? String(r.recipientIdNumber).slice(0, 40) : null,
              r.notes || null, Boolean(r.warrantyCreated),
              r.preparedAt || null, preparedBy,
            ],
          )
          await client.query(`DELETE FROM delivery_note_items WHERE dn_id = $1::uuid`, [dnId])
        } else {
          await client.query(
            `INSERT INTO delivery_notes (
              id, blob_id, dn_number, sale_order_id, client_id, sale_order_ref, customer_name,
              status, delivery_date, delivery_address, recipient_name, recipient_phone,
              recipient_id_number, notes, warranty_created, prepared_at, prepared_by, created_by
            ) VALUES (
              $1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, $8, $9::date, $10, $11, $12, $13, $14, $15,
              $16::timestamptz, $17::uuid, $17::uuid
            )`,
            [
              dnId, blobId, String(r.ref || blobId).slice(0, 30), saleOrderId, clientId,
              r.saleOrderRef ? String(r.saleOrderRef).slice(0, 40) : null,
              r.customerName ? String(r.customerName).slice(0, 200) : null,
              String(r.status || 'waiting').slice(0, 30),
              r.date || null, r.deliveryAddress || null,
              r.recipientName ? String(r.recipientName).slice(0, 150) : null,
              r.recipientPhone ? String(r.recipientPhone).slice(0, 20) : null,
              r.recipientIdNumber ? String(r.recipientIdNumber).slice(0, 40) : null,
              r.notes || null, Boolean(r.warrantyCreated),
              r.preparedAt || null, preparedBy,
            ],
          )
        }

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx]
          const serialIds = Array.isArray(line.serialIds) ? line.serialIds.map(String).filter(Boolean) : []
          const productId = asUuid(line.productId) && products.has(line.productId) ? line.productId : null
          const serialNumberId = serialIds.find(s => UUID_RE.test(s) && serials.has(s)) || null
          await client.query(
            `INSERT INTO delivery_note_items (
              id, dn_id, product_id, serial_number_id, description, product_name,
              qty, qty_done, serial_ids, source_location, line_order
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::text[], $10, $11
            )`,
            [
              uuidFromKey('dn-line', `${blobId}:${idx}`),
              dnId,
              productId,
              serialNumberId,
              line.productName ? String(line.productName) : null,
              line.productName ? String(line.productName).slice(0, 200) : null,
              Math.max(0, Number(line.qty) || 0),
              Math.max(0, Number(line.qtyDone) || 0),
              serialIds,
              line.sourceLocation ? String(line.sourceLocation).slice(0, 40) : null,
              idx,
            ],
          )
        }

        await client.query('COMMIT')
        ok++
      } catch (e) {
        await client.query('ROLLBACK')
        fail++
        console.error('fail', blobId, e.message)
      }
    }

    const notes = (await client.query(`SELECT count(*)::int AS c FROM delivery_notes`)).rows[0].c
    const items = (await client.query(`SELECT count(*)::int AS c FROM delivery_note_items`)).rows[0].c
    console.log(JSON.stringify({ mirrored: ok, failed: fail, prismaDeliveryNotes: notes, prismaItems: items, blobCount: deliveries.length }))
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
