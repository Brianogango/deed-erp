#!/usr/bin/env node
/**
 * Ops helper: add an available serial to a product (deed_serials + Prisma).
 *
 *   node scripts/add-product-serial.mjs \
 *     --name "Lenovo ThinkPad 13" \
 *     --serial LR0AWKL5 \
 *     --location warehouse
 *
 * Optional: --product-id <uuid>  (skip name match)
 *           --dry-run
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

function buildInventoryBarcode(existingBarcodes, manufacturerSerial, productSku) {
  const existing = new Set(
    existingBarcodes.map(v => String(v ?? '').trim().toUpperCase()).filter(Boolean),
  )
  const normalize = (value, fallback) => {
    const cleaned = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    return cleaned || fallback
  }
  const seed = normalize(manufacturerSerial, normalize(productSku, 'ITEM'))
  let counter = 1
  while (true) {
    const candidate = `INV-${seed}-${String(counter).padStart(4, '0')}`
    if (!existing.has(candidate)) return candidate
    counter += 1
  }
}

const nameQuery = String(arg('--name', '')).trim()
const serial = String(arg('--serial', '')).trim()
const productIdArg = String(arg('--product-id', '')).trim()
const location = String(arg('--location', 'warehouse')).trim() || 'warehouse'
const dryRun = process.argv.includes('--dry-run')

if (!serial) fail('Pass --serial SERIAL')
if (!nameQuery && !productIdArg) fail('Pass --name "Product name" or --product-id <uuid>')

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!connectionString) fail('DATABASE_URL is not set')

const pool = new Pool({ connectionString })
const LOCATIONS = new Set(['warehouse', 'shop', 'repair_unit', 'vendor', 'customer', 'employee'])
if (!LOCATIONS.has(location)) fail(`Invalid --location ${location}`)

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
    // 1) Resolve product from Prisma first, then deed_products blob.
    let product = null
    if (productIdArg) {
      const byId = await client.query(
        `SELECT id, sku, name, tracking_method FROM products WHERE id = $1`,
        [productIdArg],
      )
      if (byId.rows[0]) {
        product = {
          id: byId.rows[0].id,
          sku: byId.rows[0].sku,
          name: byId.rows[0].name,
          source: 'prisma',
        }
      }
    }

    if (!product && nameQuery) {
      const prismaMatches = await client.query(
        `SELECT id, sku, name, tracking_method, is_active
         FROM products
         WHERE name ILIKE $1
         ORDER BY is_active DESC, name ASC
         LIMIT 20`,
        [`%${nameQuery}%`],
      )
      if (prismaMatches.rows.length === 1) {
        product = {
          id: prismaMatches.rows[0].id,
          sku: prismaMatches.rows[0].sku,
          name: prismaMatches.rows[0].name,
          source: 'prisma',
        }
      } else if (prismaMatches.rows.length > 1) {
        const exact = prismaMatches.rows.filter(r =>
          String(r.name).trim().toLowerCase() === nameQuery.trim().toLowerCase(),
        )
        if (exact.length === 1) {
          product = {
            id: exact[0].id,
            sku: exact[0].sku,
            name: exact[0].name,
            source: 'prisma',
          }
        } else {
          console.error(`Multiple Prisma products matched "${nameQuery}":`)
          for (const row of prismaMatches.rows) {
            console.error(`  - ${row.name} (${row.sku}) id=${row.id} active=${row.is_active}`)
          }
          fail('Narrow --name or pass --product-id')
        }
      }
    }

    const blobProducts = await loadJsonArray(client, 'deed_products')
    if (!product && nameQuery) {
      const blobMatches = blobProducts.filter(p =>
        String(p?.name ?? '').toLowerCase().includes(nameQuery.toLowerCase()),
      )
      if (blobMatches.length === 1) {
        product = {
          id: blobMatches[0].id,
          sku: blobMatches[0].sku,
          name: blobMatches[0].name,
          source: 'deed_products',
        }
      } else if (blobMatches.length > 1) {
        const exact = blobMatches.filter(p =>
          String(p.name).trim().toLowerCase() === nameQuery.trim().toLowerCase(),
        )
        if (exact.length === 1) {
          product = {
            id: exact[0].id,
            sku: exact[0].sku,
            name: exact[0].name,
            source: 'deed_products',
          }
        } else {
          console.error(`Multiple deed_products matched "${nameQuery}":`)
          for (const p of blobMatches.slice(0, 20)) {
            console.error(`  - ${p.name} (${p.sku ?? 'no-sku'}) id=${p.id}`)
          }
          fail('Narrow --name or pass --product-id')
        }
      }
    }

    if (!product) fail(`No product matched "${nameQuery || productIdArg}"`)

    // Prefer blob product id when Prisma and blob share the same name but different ids —
    // runtime serials key off deed_serials.productId used by the ERP UI.
    const blobTwin = blobProducts.find(p =>
      String(p?.id) === product.id
      || String(p?.name ?? '').trim().toLowerCase() === String(product.name).trim().toLowerCase()
      || (product.sku && String(p?.sku ?? '').toLowerCase() === String(product.sku).toLowerCase()),
    )
    if (blobTwin?.id) {
      product = {
        id: blobTwin.id,
        sku: blobTwin.sku ?? product.sku,
        name: blobTwin.name ?? product.name,
        source: product.source === 'prisma' ? 'prisma+deed_products' : product.source,
        prismaId: product.source.startsWith('prisma') ? product.id : undefined,
      }
    }

    console.log(`Product: ${product.name}`)
    console.log(`  id=${product.id} sku=${product.sku ?? '(none)'} source=${product.source}`)

    const serials = await loadJsonArray(client, 'deed_serials')
    const serialConflict = serials.find(s =>
      String(s?.serial ?? '').toLowerCase() === serial.toLowerCase(),
    )
    if (serialConflict) {
      fail(`Serial "${serial}" already exists on productId=${serialConflict.productId} (status=${serialConflict.status})`)
    }

    const prismaSerial = await client.query(
      `SELECT id, product_id, serial_number, status FROM serial_numbers
       WHERE lower(serial_number) = lower($1)`,
      [serial],
    )
    if (prismaSerial.rows[0]) {
      fail(`Serial "${serial}" already exists in serial_numbers (product_id=${prismaSerial.rows[0].product_id})`)
    }

    const barcode = buildInventoryBarcode(
      serials.map(s => s.barcode),
      serial,
      product.sku || product.id,
    )
    const id = randomUUID()
    const receivedDate = todayLocal()
    const record = {
      id,
      serial,
      productId: product.id,
      productName: product.name,
      sku: product.sku || undefined,
      location,
      status: 'available',
      receivedDate,
      barcode,
    }

    console.log(`Will add serial ${serial}`)
    console.log(`  location=${location} status=available barcode=${barcode}`)
    if (dryRun) {
      console.log('Dry run — no write.')
      return
    }

    await client.query('BEGIN')
    try {
      const next = [record, ...serials]
      await saveJsonArray(client, 'deed_serials', next)

      // Also insert into Prisma when the product id is a UUID that exists in products.
      const prismaProductId = product.prismaId || product.id
      const prismaProduct = await client.query(`SELECT id FROM products WHERE id = $1`, [prismaProductId])
      if (prismaProduct.rows[0]) {
        await client.query(
          `INSERT INTO serial_numbers
             (id, product_id, serial_number, inventory_barcode, status, notes, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'in_stock', $5, NOW(), NOW())
           ON CONFLICT (serial_number) DO NOTHING`,
          [id, prismaProductId, serial, barcode, `Ops add ${receivedDate}; location=${location}`],
        )
        // Ensure SERIAL tracking so availability counts include this unit.
        await client.query(
          `UPDATE products
           SET tracking_method = 'SERIAL', track_stock = true, updated_at = NOW()
           WHERE id = $1::uuid AND tracking_method IS DISTINCT FROM 'SERIAL'`,
          [prismaProductId],
        )
      } else {
        console.log('Note: product id not in Prisma products — wrote deed_serials only.')
      }

      await client.query('COMMIT')
      console.log(`OK added serial ${serial} → ${product.name}`)
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
