#!/usr/bin/env node
/**
 * Fix orphan inventory blob rows that reference a deleted product, then
 * re-mirror so blob/Prisma counts match for certify.
 *
 * Usage: cd /var/www/deed-erp && node scripts/fix-orphan-inventory-parity.mjs
 */
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { readFileSync } from 'fs'

const require = createRequire(import.meta.url)
const { Pool } = require('pg')

const ORPHAN_PRODUCT_ID = '7fafba32-afd9-4b90-9515-ff767db7d577'

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  return readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
}

function uuidFromKey(namespace, key) {
  const h = createHash('md5').update(`${namespace}:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

async function main() {
  const pool = new Pool({ connectionString: loadDbUrl() })
  const client = await pool.connect()
  try {
    const exists = await client.query(`SELECT id FROM products WHERE id = $1::uuid`, [ORPHAN_PRODUCT_ID])
    if (!exists.rows[0]) {
      const user = (await client.query(`SELECT id::text FROM users ORDER BY created_at ASC LIMIT 1`)).rows[0]?.id
      await client.query(
        `INSERT INTO products (
           id, sku, name, product_type, specs, cost_price, selling_price,
           track_stock, tracking_method, is_active, created_by, created_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, 'new', '{}'::jsonb, 0, 0,
           true, 'QUANTITY', false, $4::uuid, NOW(), NOW()
         )`,
        [
          ORPHAN_PRODUCT_ID,
          `ORPHAN-${ORPHAN_PRODUCT_ID.slice(0, 8)}`,
          '[Archived] Orphaned inventory product (parity tombstone)',
          user || null,
        ],
      )
      console.log('Created orphan product tombstone', ORPHAN_PRODUCT_ID)
    } else {
      console.log('Orphan product already exists')
    }

    // Backfill missing stock move
    const moves = JSON.parse((await client.query(`SELECT value FROM app_state WHERE key='deed_stockMoves'`)).rows[0].value)
    const missingMove = moves.find(m => m.productId === ORPHAN_PRODUCT_ID)
    if (missingMove) {
      const id = missingMove.id
      const existing = await client.query(`SELECT id FROM stock_movements WHERE blob_id=$1 OR id=$2::uuid`, [id, id])
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO stock_movements (
             id, blob_id, product_id, movement_type, qty, qty_before, qty_after,
             from_location, to_location, document_ref, serial_numbers, notes, created_at, reference_type
           ) VALUES (
             $1::uuid, $1, $2::uuid, 'purchase_receive', $3, 0, 0,
             NULL, $4, $5, $6::text[], $7, $8::date, 'blob_stock_move'
           )`,
          [
            id,
            ORPHAN_PRODUCT_ID,
            Math.abs(Number(missingMove.qty) || 0),
            missingMove.toLocation || 'warehouse',
            missingMove.documentRef || null,
            Array.isArray(missingMove.serialNumbers) ? missingMove.serialNumbers : [],
            missingMove.reason || null,
            String(missingMove.date || new Date().toISOString().slice(0, 10)),
          ],
        )
        console.log('Inserted missing stock move', id)
      }
    }

    // Backfill missing bulk
    const bulk = JSON.parse((await client.query(`SELECT value FROM app_state WHERE key='deed_bulkStock'`)).rows[0].value)
    const missingBulk = bulk.find(b => b.productId === ORPHAN_PRODUCT_ID)
    if (missingBulk) {
      const location = missingBulk.location || 'warehouse'
      const id = uuidFromKey('bulk-stock', `${ORPHAN_PRODUCT_ID}:${location}`)
      await client.query(
        `INSERT INTO bulk_stock_levels (id, product_id, location, qty)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         ON CONFLICT (product_id, location) DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
        [id, ORPHAN_PRODUCT_ID, location, Math.max(0, Number(missingBulk.qty) || 0)],
      )
      console.log('Upserted missing bulk stock', ORPHAN_PRODUCT_ID, location)
    }

    const counts = (await client.query(`SELECT
      (SELECT COUNT(*) FROM stock_movements)::int AS moves,
      (SELECT COUNT(*) FROM bulk_stock_levels)::int AS bulk,
      (SELECT jsonb_array_length(value::jsonb) FROM app_state WHERE key='deed_stockMoves') AS blob_moves,
      (SELECT jsonb_array_length(value::jsonb) FROM app_state WHERE key='deed_bulkStock') AS blob_bulk`)).rows[0]
    console.log(JSON.stringify(counts))
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
