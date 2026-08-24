#!/usr/bin/env node
/**
 * Ops helper: add bulk (non-serial) accessory quantities as opening stock.
 *
 * Updates deed_bulkStock, deed_products.stockQty, deed_stockMoves (OPENING),
 * and Prisma stock_levels.
 *
 *   node scripts/add-opening-bulk-stock.mjs --request ops/add-opening-bulk-stock-request.json
 *   node scripts/add-opening-bulk-stock.mjs --request ... --apply
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
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

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

function upsertBulk(levels, productId, location, delta) {
  const current = levels.find(l => l.productId === productId && l.location === location)?.qty ?? 0
  const nextQty = Math.max(0, current + delta)
  const remaining = levels.filter(l => !(l.productId === productId && l.location === location))
  return nextQty > 0 ? [...remaining, { productId, location, qty: nextQty }] : remaining
}

const requestPath = arg('--request')
const apply = process.argv.includes('--apply')
if (!requestPath) fail('Pass --request path/to/request.json')

const absRequest = resolve(ROOT, requestPath)
if (!existsSync(absRequest)) fail(`Request file not found: ${absRequest}`)

let request
try {
  request = JSON.parse(readFileSync(absRequest, 'utf8'))
} catch (err) {
  fail(`Invalid request JSON: ${err.message}`)
}

const location = String(request.location || 'warehouse').trim() || 'warehouse'
const documentRef = String(request.documentRef || 'OPENING').trim() || 'OPENING'
const reason = String(request.reason || 'Opening stock').trim() || 'Opening stock'
const items = Array.isArray(request.items) ? request.items : []
if (!items.length) fail('Request items[] is empty')

const LOCATIONS = new Set(['warehouse', 'shop', 'repair_unit', 'vendor', 'customer', 'employee'])
if (!LOCATIONS.has(location)) fail(`Invalid location ${location}`)

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const pool = new Pool({ connectionString })

async function loadJson(client, key, fallback) {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows.length) return fallback
  try {
    return JSON.parse(rows[0].value)
  } catch {
    return fallback
  }
}

async function saveJson(client, key, value) {
  const payload = JSON.stringify(value)
  const updatedAt = new Date().toISOString()
  await client.query(
    `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, payload, updatedAt],
  )
}

async function resolveProduct(client, blobProducts, nameQuery, productId) {
  if (productId) {
    const byId = await client.query(
      `SELECT id, sku, name, tracking_method FROM products WHERE id = $1`,
      [productId],
    )
    if (byId.rows[0]) {
      return {
        id: byId.rows[0].id,
        sku: byId.rows[0].sku,
        name: byId.rows[0].name,
        trackingMethod: byId.rows[0].tracking_method,
        source: 'prisma',
      }
    }
    const blob = blobProducts.find(p => String(p?.id) === productId)
    if (blob) {
      return {
        id: blob.id,
        sku: blob.sku,
        name: blob.name,
        trackingMethod: blob.trackingMethod || blob.tracking_method,
        requiresSerial: Boolean(blob.requiresSerial),
        source: 'deed_products',
      }
    }
    return null
  }

  const q = String(nameQuery || '').trim()
  if (!q) return null

  const prismaMatches = await client.query(
    `SELECT id, sku, name, tracking_method, is_active
     FROM products
     WHERE name ILIKE $1
     ORDER BY is_active DESC, name ASC
     LIMIT 20`,
    [q], // exact-ish: use = later; ILIKE without % for exact case-insensitive first
  )

  // Prefer exact case-insensitive match from broader search
  const prismaLoose = await client.query(
    `SELECT id, sku, name, tracking_method, is_active
     FROM products
     WHERE name ILIKE $1
     ORDER BY is_active DESC, name ASC
     LIMIT 20`,
    [`%${q}%`],
  )

  let product = null
  const exactPrisma = prismaLoose.rows.filter(r => norm(r.name) === norm(q))
  if (exactPrisma.length === 1) {
    product = {
      id: exactPrisma[0].id,
      sku: exactPrisma[0].sku,
      name: exactPrisma[0].name,
      trackingMethod: exactPrisma[0].tracking_method,
      source: 'prisma',
    }
  } else if (prismaMatches.rows.length === 1 && norm(prismaMatches.rows[0].name) === norm(q)) {
    product = {
      id: prismaMatches.rows[0].id,
      sku: prismaMatches.rows[0].sku,
      name: prismaMatches.rows[0].name,
      trackingMethod: prismaMatches.rows[0].tracking_method,
      source: 'prisma',
    }
  }

  const blobExact = blobProducts.filter(p => norm(p?.name) === norm(q))
  if (!product && blobExact.length === 1) {
    product = {
      id: blobExact[0].id,
      sku: blobExact[0].sku,
      name: blobExact[0].name,
      trackingMethod: blobExact[0].trackingMethod || blobExact[0].tracking_method,
      requiresSerial: Boolean(blobExact[0].requiresSerial),
      source: 'deed_products',
    }
  }

  if (!product) {
    if (prismaLoose.rows.length || blobProducts.filter(p => norm(p?.name).includes(norm(q))).length) {
      console.error(`No exact product match for "${q}". Candidates:`)
      for (const r of prismaLoose.rows.slice(0, 10)) {
        console.error(`  - ${r.name} (${r.sku}) id=${r.id}`)
      }
    }
    return null
  }

  // Prefer blob twin id (UI keys off deed_* productId)
  const blobTwin = blobProducts.find(p =>
    String(p?.id) === product.id
    || norm(p?.name) === norm(product.name)
    || (product.sku && norm(p?.sku) === norm(product.sku)),
  )
  if (blobTwin?.id) {
    return {
      id: blobTwin.id,
      sku: blobTwin.sku ?? product.sku,
      name: blobTwin.name ?? product.name,
      trackingMethod: product.trackingMethod || blobTwin.trackingMethod || blobTwin.tracking_method,
      requiresSerial: Boolean(blobTwin.requiresSerial),
      source: product.source === 'prisma' ? 'prisma+deed_products' : product.source,
      prismaId: product.source.startsWith('prisma') ? product.id : undefined,
    }
  }
  return product
}

async function main() {
  console.log(apply ? 'MODE: APPLY' : 'MODE: DRY-RUN')
  console.log(`location=${location} documentRef=${documentRef} items=${items.length}\n`)

  const client = await pool.connect()
  try {
    let products = await loadJson(client, 'deed_products', [])
    if (!Array.isArray(products)) products = []
    let bulkStock = await loadJson(client, 'deed_bulkStock', [])
    if (!Array.isArray(bulkStock)) bulkStock = []
    let stockMoves = await loadJson(client, 'deed_stockMoves', [])
    if (!Array.isArray(stockMoves)) stockMoves = []

    const plan = []
    const errors = []

    for (const raw of items) {
      const name = String(raw?.name ?? '').trim()
      const qty = Number(raw?.qty)
      const productId = raw?.productId ? String(raw.productId).trim() : ''
      if (!name && !productId) {
        errors.push('Item missing name/productId')
        continue
      }
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
        errors.push(`Invalid qty for "${name || productId}": ${raw?.qty}`)
        continue
      }

      const product = await resolveProduct(client, products, name, productId)
      if (!product) {
        errors.push(`Product not found: ${name || productId}`)
        continue
      }

      const isSerial =
        product.requiresSerial === true
        || String(product.trackingMethod || '').toUpperCase() === 'SERIAL'
      if (isSerial) {
        errors.push(`Refusing SERIAL product (use add-product-serial): ${product.name}`)
        continue
      }

      const already = stockMoves.some(m =>
        String(m?.documentRef ?? '') === documentRef
        && String(m?.productId ?? '') === product.id
        && String(m?.reason ?? '') === reason,
      )
      const currentQty = bulkStock.find(l => l.productId === product.id && l.location === location)?.qty ?? 0

      plan.push({
        name: product.name,
        productId: product.id,
        prismaId: product.prismaId || (product.source.startsWith('prisma') ? product.id : null),
        qty,
        currentQty,
        nextQty: currentQty + qty,
        skip: already,
        source: product.source,
      })
    }

    if (errors.length) {
      console.error('Resolution errors:')
      for (const e of errors) console.error(`  - ${e}`)
      fail(`${errors.length} item(s) could not be resolved — aborting (no writes)`)
    }

    let toApply = 0
    let skipped = 0
    for (const row of plan) {
      if (row.skip) {
        skipped += 1
        console.log(`SKIP already posted ${documentRef}: ${row.name} (+${row.qty}) current=${row.currentQty}`)
      } else {
        toApply += 1
        console.log(`ADD ${row.name}: ${row.currentQty} → ${row.nextQty} (+${row.qty}) [${row.source}]`)
      }
    }

    console.log(`\nPlan: ${toApply} to add, ${skipped} already present, ${plan.length} total`)
    writeFileSync('/tmp/add-opening-bulk-stock-plan.json', JSON.stringify({ location, documentRef, plan }, null, 2))

    if (!apply) {
      console.log('Dry-run complete — re-run with --apply to write.')
      return
    }

    if (toApply === 0) {
      console.log('Nothing new to apply.')
      return
    }

    await client.query('BEGIN')
    try {
      const date = todayLocal()
      const newMoves = []
      const prismaDeltas = new Map()

      for (const row of plan) {
        if (row.skip) continue
        bulkStock = upsertBulk(bulkStock, row.productId, location, row.qty)
        products = products.map(p =>
          String(p?.id) === row.productId
            ? { ...p, stockQty: Math.max(0, (Number(p.stockQty) || 0) + row.qty) }
            : p,
        )
        const move = {
          id: randomUUID(),
          type: 'in',
          productId: row.productId,
          productName: row.name,
          qty: row.qty,
          reason,
          toLocation: location,
          serialNumbers: [],
          date,
          userId: 'system',
          documentRef,
        }
        newMoves.push(move)
        const prismaKey = row.prismaId || row.productId
        prismaDeltas.set(prismaKey, (prismaDeltas.get(prismaKey) || 0) + row.qty)
      }

      stockMoves = [...newMoves, ...stockMoves]

      await saveJson(client, 'deed_bulkStock', bulkStock)
      await saveJson(client, 'deed_products', products)
      await saveJson(client, 'deed_stockMoves', stockMoves)

      for (const [productId, delta] of prismaDeltas) {
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
        // Reconfiguration Apply consumes bulk_stock_levels (location bins),
        // not stock_levels.qty_on_hand. Keep the two in step.
        await client.query(
          `INSERT INTO bulk_stock_levels (id, product_id, location, qty, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, NOW())
           ON CONFLICT (product_id, location) DO UPDATE
             SET qty = GREATEST(0, bulk_stock_levels.qty + EXCLUDED.qty),
                 updated_at = NOW()`,
          [randomUUID(), productId, location, delta],
        )
      }

      await client.query('COMMIT')
      console.log(`\nOK opening bulk stock posted: ${newMoves.length} product(s), ref=${documentRef}`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
