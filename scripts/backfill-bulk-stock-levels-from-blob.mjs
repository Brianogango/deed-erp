#!/usr/bin/env node
/**
 * One-time backfill: seed the new relational bulk_stock_levels table from
 * the current deed_bulkStock blob snapshot, so existing location-level
 * quantities (warehouse/shop/pending_testing/quarantine/etc per product)
 * are durably represented in the database, not only as JSON.
 *
 * This is a snapshot copy of CURRENT quantities only — it does not attempt
 * to reconstruct stock_movements history from deed_stockMoves (blob move
 * records are not reliably parseable into the strict qtyBefore/qtyAfter
 * shape the relational table requires). Going forward, every reconfig
 * remove/install call now writes bulk_stock_levels + stock_movements
 * directly (lib/reconfiguration/service.ts's applyBulkStockPlanToPrisma) —
 * this script only catches up on records already in deed_bulkStock before
 * that code shipped.
 *
 * Idempotent: upserts on (productId, location), so re-running just
 * re-syncs qty to the blob's current value. Skips a blob row when its
 * productId is not a real Prisma product (nothing to attach the FK to) or
 * qty is 0 (nothing to represent).
 *
 *   node scripts/backfill-bulk-stock-levels-from-blob.mjs --dry-run
 *   node scripts/backfill-bulk-stock-levels-from-blob.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
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

const dryRun = process.argv.includes('--dry-run')

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function main() {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(`SELECT value FROM app_state WHERE key = 'deed_bulkStock'`)
    const bulkStock = rows.length ? JSON.parse(rows[0].value) : []
    if (!Array.isArray(bulkStock)) {
      console.error('deed_bulkStock blob is not an array — nothing to backfill')
      return
    }
    console.log(`deed_bulkStock has ${bulkStock.length} row(s)`)

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    // A blob productId can be a legacy non-UUID string (e.g. client-generated
    // ids from before the Prisma catalogue existed) — casting those to
    // ::uuid[] would fail the whole query, so filter to UUID-shaped ids first.
    const productIds = [...new Set(bulkStock.map(r => r.productId).filter(id => UUID_RE.test(String(id || ''))))]
    const validIds = new Set()
    if (productIds.length) {
      const { rows: found } = await client.query(`SELECT id FROM products WHERE id = ANY($1::uuid[])`, [productIds])
      for (const r of found) validIds.add(r.id)
    }

    let upserted = 0
    let skippedInvalidProduct = 0
    let skippedZeroQty = 0

    for (const row of bulkStock) {
      const productId = row?.productId
      const location = String(row?.location || '').trim()
      const qty = Math.max(0, Math.trunc(Number(row?.qty) || 0))
      if (!productId || !location) continue
      if (!validIds.has(productId)) { skippedInvalidProduct += 1; continue }
      if (qty === 0) { skippedZeroQty += 1; continue }

      if (dryRun) {
        console.log(`[dry-run] upsert ${productId} @ ${location} -> qty=${qty}`)
        upserted += 1
        continue
      }

      await client.query(
        `INSERT INTO bulk_stock_levels (id, product_id, location, qty, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (product_id, location) DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()`,
        [randomUUID(), productId, location, qty],
      )
      upserted += 1
    }

    console.log(
      `${dryRun ? '[dry-run] would upsert' : 'Upserted'} ${upserted} row(s); ` +
        `skipped ${skippedInvalidProduct} (product not in Prisma), ${skippedZeroQty} (qty=0)`,
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
