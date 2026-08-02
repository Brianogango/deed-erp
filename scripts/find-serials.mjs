#!/usr/bin/env node
/**
 * Ops helper: locate serial-like strings across deed blobs + Prisma.
 *
 *   node scripts/find-serials.mjs --q LR0AWKD --q FVFDJB00MNHP
 *   node scripts/find-serials.mjs --request ops/find-serials-request.json
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

const requestPath = String(arg('--request', '')).trim()
let queries = allArgs('--q').map(s => String(s).trim()).filter(Boolean)
if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromFile = Array.isArray(parsed?.queries) ? parsed.queries : []
  queries = [...queries, ...fromFile.map(s => String(s).trim()).filter(Boolean)]
}
if (!queries.length) fail('Pass --q TEXT or --request ops/find-serials-request.json')

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

function collectSerialish(value, path, hits, needle) {
  if (value == null) return
  if (typeof value === 'string') {
    if (value.toUpperCase().includes(needle)) hits.push({ path, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectSerialish(item, `${path}[${i}]`, hits, needle))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (['serial', 'serials', 'serialIds', 'serialNumber', 'barcode', 'inventoryBarcode', 'ref', 'name'].includes(k) || typeof v === 'object') {
        collectSerialish(v, path ? `${path}.${k}` : k, hits, needle)
      }
    }
  }
}

async function main() {
  const client = await pool.connect()
  try {
    const serials = await loadJsonArray(client, 'deed_serials')
    console.log(`deed_serials count: ${serials.length}`)
    const lrPrefix = serials
      .filter(s => String(s.serial || '').toUpperCase().startsWith('LR0AW'))
      .map(s => `${s.serial} [${s.status}/${s.location}] ${s.productName || ''}`)
    console.log(`LR0AW* serials (${lrPrefix.length}):`)
    for (const line of lrPrefix.slice(0, 40)) console.log(`  ${line}`)

    const keys = [
      'deed_serials',
      'deed_receipts',
      'deed_purchaseOrders',
      'deed_saleOrders',
      'deed_invoices',
      'deed_deliveries',
      'deed_posOrders',
      'deed_outboundReleases',
      'deed_stockTransfers',
    ]

    for (const q of queries) {
      const needle = q.toUpperCase()
      console.log(`\n=== Query: ${q} ===`)
      const exact = serials.filter(s => String(s.serial || '').toUpperCase() === needle)
      const fuzzy = serials.filter(s => {
        const serial = String(s.serial || '').toUpperCase()
        const barcode = String(s.barcode || '').toUpperCase()
        return serial.includes(needle) || needle.includes(serial) || barcode.includes(needle)
      })
      console.log(`deed_serials exact=${exact.length} fuzzy=${fuzzy.length}`)
      for (const row of fuzzy.slice(0, 20)) {
        console.log(`  ${row.serial} [${row.status}/${row.location}] barcode=${row.barcode || '-'} product=${row.productName || row.productId}`)
      }

      try {
        const prisma = await client.query(
          `SELECT serial_number, status, inventory_barcode, product_id
           FROM serial_numbers
           WHERE lower(serial_number) LIKE $1 OR lower(COALESCE(inventory_barcode,'')) LIKE $1
           LIMIT 20`,
          [`%${q.toLowerCase()}%`],
        )
        console.log(`prisma serial_numbers: ${prisma.rows.length}`)
        for (const row of prisma.rows) {
          console.log(`  ${row.serial_number} [${row.status}] barcode=${row.inventory_barcode || '-'} product=${row.product_id}`)
        }
      } catch (err) {
        console.log(`prisma lookup failed: ${err instanceof Error ? err.message : String(err)}`)
      }

      for (const key of keys) {
        const rows = await loadJsonArray(client, key)
        const hits = []
        collectSerialish(rows, key, hits, needle)
        if (hits.length) {
          console.log(`${key} hits: ${hits.length}`)
          for (const hit of hits.slice(0, 15)) {
            console.log(`  ${hit.path} = ${hit.value}`)
          }
        }
      }
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
