#!/usr/bin/env node
/**
 * Ops helper: mark manufacturer serials as already sold so they leave Available stock.
 *
 * Does NOT hard-delete — keeps history for trade-in / buyback lookups.
 *
 *   node scripts/mark-serials-sold.mjs --serial LR0AWKD --serial PF1CX9NP
 *   node scripts/mark-serials-sold.mjs --request ops/mark-serials-sold-request.json
 *   node scripts/mark-serials-sold.mjs --request ops/mark-serials-sold-request.json --dry-run
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

function allArgs(flag) {
  const out = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1])
  }
  return out
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

function normalizeSerial(value) {
  return String(value ?? '').trim().toUpperCase()
}

const requestPath = String(arg('--request', '')).trim()
const dryRun = process.argv.includes('--dry-run')
const soldDateArg = String(arg('--sold-date', '')).trim()
const soldDate = soldDateArg || todayLocal()

/** @type {string[]} */
let requested = allArgs('--serial').map(s => String(s).trim()).filter(Boolean)

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    fail(`Invalid JSON in ${abs}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const fromFile = Array.isArray(parsed?.serials) ? parsed.serials : []
  requested = [...requested, ...fromFile.map(s => String(s).trim()).filter(Boolean)]
  if (parsed?.dryRun === true) {
    // allow request file to force dry-run
  }
}

// Deduplicate case-insensitively while preserving first casing.
const seen = new Set()
const serialsWanted = []
for (const serial of requested) {
  const key = normalizeSerial(serial)
  if (!key || seen.has(key)) continue
  seen.add(key)
  serialsWanted.push(serial)
}

if (serialsWanted.length === 0) {
  fail('Pass --serial SERIAL (repeatable) or --request ops/mark-serials-sold-request.json')
}

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
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
  const wantedKeys = new Set(serialsWanted.map(normalizeSerial))
  const client = await pool.connect()
  try {
    const serials = await loadJsonArray(client, 'deed_serials')
    const products = await loadJsonArray(client, 'deed_products')

    /** @type {Map<string, object[]>} */
    const matchesByKey = new Map()
    for (const row of serials) {
      const key = normalizeSerial(row?.serial)
      if (!wantedKeys.has(key)) continue
      if (!matchesByKey.has(key)) matchesByKey.set(key, [])
      matchesByKey.get(key).push(row)
    }

    const missing = serialsWanted.filter(s => !matchesByKey.has(normalizeSerial(s)))
    const alreadySold = []
    const toMark = []
    /** @type {Map<string, number>} */
    const stockDeltaByProduct = new Map()

    for (const [key, rows] of matchesByKey) {
      for (const row of rows) {
        const status = String(row.status || '').toLowerCase()
        if (status === 'sold') {
          alreadySold.push(row.serial || key)
          continue
        }
        toMark.push(row)
        if (row.productId) {
          stockDeltaByProduct.set(row.productId, (stockDeltaByProduct.get(row.productId) || 0) + 1)
        }
      }
    }

    console.log(`Requested: ${serialsWanted.length}`)
    console.log(`Found in deed_serials: ${[...matchesByKey.values()].reduce((n, rows) => n + rows.length, 0)}`)
    console.log(`Already sold: ${alreadySold.length}`)
    console.log(`Will mark sold: ${toMark.length}`)
    if (missing.length) {
      console.log(`MISSING (exact match not in deed_serials): ${missing.join(', ')}`)
      for (const needle of missing) {
        const key = normalizeSerial(needle)
        const fuzzy = serials
          .filter(row => {
            const serial = normalizeSerial(row?.serial)
            const barcode = normalizeSerial(row?.barcode)
            return serial.includes(key) || key.includes(serial) || barcode.includes(key)
          })
          .slice(0, 12)
        if (fuzzy.length) {
          console.log(`  Fuzzy deed_serials matches for ${needle}:`)
          for (const row of fuzzy) {
            console.log(
              `    ${row.serial}  [${row.status}/${row.location}]  barcode=${row.barcode || '-'}  product=${row.productName || row.productId || '?'}`,
            )
          }
        } else {
          console.log(`  No fuzzy deed_serials match for ${needle}`)
        }
        try {
          const prismaHits = await client.query(
            `SELECT serial_number, status, inventory_barcode, product_id
             FROM serial_numbers
             WHERE lower(serial_number) LIKE $1
                OR lower(COALESCE(inventory_barcode, '')) LIKE $1
             LIMIT 12`,
            [`%${key.toLowerCase()}%`],
          )
          if (prismaHits.rows.length) {
            console.log(`  Prisma serial_numbers matches for ${needle}:`)
            for (const row of prismaHits.rows) {
              console.log(
                `    ${row.serial_number}  [${row.status}]  barcode=${row.inventory_barcode || '-'}  product=${row.product_id}`,
              )
            }
          }
        } catch (err) {
          console.log(
            `  Note: Prisma lookup skipped (${err instanceof Error ? err.message : String(err)})`,
          )
        }
        try {
          const blobHits = await client.query(
            `SELECT key
             FROM app_state
             WHERE value ILIKE $1
             ORDER BY key
             LIMIT 20`,
            [`%${needle}%`],
          )
          if (blobHits.rows.length) {
            console.log(
              `  app_state keys containing ${needle}: ${blobHits.rows.map(r => r.key).join(', ')}`,
            )
          }
        } catch {
          // ignore
        }
      }
    }

    for (const row of toMark) {
      console.log(
        `  ${row.serial}  [${row.status}/${row.location}]  → sold/customer  product=${row.productName || row.productId || '?'}`,
      )
    }

    if (toMark.length === 0) {
      console.log(dryRun ? 'Dry-run: nothing to change.' : 'Nothing to change.')
      // Exit 0 when everything requested is already sold; only fail hard if
      // serials were missing and nothing could be updated.
      if (missing.length && alreadySold.length === 0) process.exitCode = 2
      return
    }

    if (dryRun) {
      console.log('Dry-run: no writes performed.')
      return
    }

    const markIds = new Set(toMark.map(r => r.id))
    const nextSerials = serials.map(row => {
      if (!markIds.has(row.id)) return row
      return {
        ...row,
        status: 'sold',
        location: 'customer',
        soldDate: row.soldDate || soldDate,
      }
    })

    const nextProducts = products.map(product => {
      const delta = stockDeltaByProduct.get(product.id) || 0
      if (!delta) return product
      const nextQty = Math.max(0, (Number(product.stockQty) || 0) - delta)
      if (nextQty === product.stockQty) return product
      return { ...product, stockQty: nextQty }
    })

    await client.query('BEGIN')
    try {
      await saveJsonArray(client, 'deed_serials', nextSerials)
      if ([...stockDeltaByProduct.values()].some(v => v > 0)) {
        await saveJsonArray(client, 'deed_products', nextProducts)
      }

      // Best-effort Prisma mirror — blob is source of truth for Available qty.
      const serialLabels = toMark.map(r => String(r.serial || '').trim()).filter(Boolean)
      if (serialLabels.length) {
        try {
          const updated = await client.query(
            `UPDATE serial_numbers
             SET status = 'sold',
                 updated_at = NOW()
             WHERE lower(serial_number) = ANY($1::text[])`,
            [serialLabels.map(s => s.toLowerCase())],
          )
          console.log(`Prisma serial_numbers updated: ${updated.rowCount}`)
        } catch (err) {
          console.log(
            `Note: skipped Prisma serial_numbers update (${err instanceof Error ? err.message : String(err)})`,
          )
        }
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    console.log(`Marked ${toMark.length} serial(s) as sold.`)
    for (const [productId, delta] of stockDeltaByProduct) {
      const product = nextProducts.find(p => p.id === productId)
      console.log(
        `  stockQty -${delta} → ${product?.stockQty ?? '?'}  (${product?.name || productId})`,
      )
    }
    // Partial success should not fail the Contabo job — missing serials are
    // reported above for follow-up.
    if (missing.length) {
      console.log(`WARNING: ${missing.length} serial(s) were not found exactly; see fuzzy matches above.`)
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
