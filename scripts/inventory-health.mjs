#!/usr/bin/env node
/**
 * What is wrong with the inventory, measured before anything is changed.
 *
 *   node scripts/inventory-health.mjs            the report
 *   node scripts/inventory-health.mjs --json     the same as JSON
 *   node scripts/inventory-health.mjs --serial 5CG7103VK4   one unit's history
 *
 * Read-only: it runs SELECTs and nothing else. Nothing here corrects
 * anything — each section is a list to decide on, and the correction for a
 * section is written only once its size and shape are known.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const serialArg = (() => {
  const i = args.indexOf('--serial')
  return i >= 0 && args[i + 1] ? args[i + 1] : ''
})()
const limit = (() => {
  const i = args.indexOf('--limit')
  const n = i >= 0 ? Number(args[i + 1]) : 0
  return Number.isFinite(n) && n > 0 ? Math.min(500, n) : 40
})()

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('ERROR: DATABASE_URL / POSTGRES_URL is not set')
  process.exit(1)
}
const pool = new Pool({ connectionString, ssl: false })
const q = (text, values = []) => pool.query(text, values).then(r => r.rows).catch(err => {
  console.error(`  (query failed: ${err.message})`)
  return []
})

const pad = (v, w) => String(v ?? '').padEnd(w).slice(0, w)
const day = v => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '—')

/** A serial as two people would type it: case and punctuation removed. */
const NORMALISED = `upper(regexp_replace(s.serial_number, '[^A-Za-z0-9]', '', 'g'))`

/** Every way a unit can be shown to have been sold. */
const SOLD_EVIDENCE = `(
  s.sold_via_invoice_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM sale_order_items soi WHERE s.id::text = ANY(soi.serial_ids))
  OR EXISTS (SELECT 1 FROM pos_transaction_items p WHERE p.serial_number_id = s.id)
  OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.serial_number_id = s.id)
)`

const sections = []
const section = (title, note, rows, columns) => sections.push({ title, note, rows, columns })

async function oneSerial(serial) {
  const [unit] = await q(`
    SELECT s.id, s.serial_number, s.status, s.location, s.updated_at, s.created_at,
           pr.name AS product, pr.sku,
           s.screen_extras->>'soldDate' AS sold_date,
           s.screen_extras->>'saleOrderId' AS sale_order_id,
           i.invoice_number, i.invoice_date, c.name AS customer
      FROM serial_numbers s
      LEFT JOIN products pr ON pr.id = s.product_id
      LEFT JOIN invoices i ON i.id = s.sold_via_invoice_id
      LEFT JOIN clients  c ON c.id = i.client_id
     WHERE upper(regexp_replace(s.serial_number, '[^A-Za-z0-9]', '', 'g'))
         = upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g'))
     LIMIT 1`, [serial])
  if (!unit) { console.log(`\nNo serial matching "${serial}".\n`); return }

  console.log('')
  console.log(`SERIAL ${unit.serial_number}  ·  ${unit.product ?? 'product missing'}  ·  ${unit.sku ?? ''}`)
  console.log(`status ${unit.status}   location ${unit.location ?? '—'}   first seen ${day(unit.created_at)}   last changed ${day(unit.updated_at)}`)
  console.log(unit.invoice_number
    ? `sold on invoice ${unit.invoice_number} (${day(unit.invoice_date)}) to ${unit.customer ?? 'unnamed customer'}`
    : `no invoice recorded against this unit${unit.sold_date ? ` (the screen says sold ${day(unit.sold_date)})` : ''}`)
  console.log('')

  const orders = await q(`
    SELECT so.order_number, so.order_date, so.status, cl.name AS customer
      FROM sale_order_items soi
      JOIN sale_orders so ON so.id = soi.sale_order_id
      LEFT JOIN clients cl ON cl.id = so.client_id
     WHERE $1 = ANY(soi.serial_ids)`, [unit.id ?? ''])
  const movements = await q(`
    SELECT m.created_at, m.movement_type, m.from_location, m.to_location, m.document_ref, m.notes
      FROM stock_movements m
      JOIN serial_numbers s ON s.id = m.serial_number_id
     WHERE s.serial_number = $1
     ORDER BY m.created_at`, [unit.serial_number])

  console.log('MOVEMENT HISTORY')
  if (!movements.length) {
    console.log('  none recorded — nothing says this unit ever moved, in or out.')
  } else {
    for (const m of movements) {
      console.log(`  ${pad(day(m.created_at), 12)} ${pad(m.movement_type, 16)} ${pad(`${m.from_location ?? '—'} → ${m.to_location ?? '—'}`, 28)} ${m.document_ref ?? ''} ${m.notes ?? ''}`)
    }
  }
  if (orders.length) {
    console.log('')
    console.log('ON SALE ORDERS')
    for (const o of orders) console.log(`  ${pad(o.order_number, 16)} ${pad(day(o.order_date), 12)} ${pad(o.status, 14)} ${o.customer ?? ''}`)
  }
  console.log('')
}

async function report() {
  // ── 1. Sold with nothing to show for it ────────────────────────────────
  section(
    'MARKED SOLD OR WITH A CUSTOMER, NO SALE ON RECORD',
    'No invoice, sale order, till sale or invoice line names these units. If they are on the shelf, the status is simply wrong.',
    await q(`
      SELECT s.serial_number, pr.name AS product, s.status, s.location,
             s.updated_at, s.screen_extras->>'soldDate' AS screen_sold_date,
             EXISTS (SELECT 1 FROM stock_movements m WHERE m.serial_number_id = s.id) AS has_movements
        FROM serial_numbers s
        LEFT JOIN products pr ON pr.id = s.product_id
       WHERE s.removed_at IS NULL
         AND (s.status = 'sold' OR s.location = 'customer')
         AND NOT ${SOLD_EVIDENCE}
       ORDER BY s.updated_at DESC
       LIMIT ${limit}`),
    ['serial_number', 'product', 'status', 'location', 'updated_at', 'screen_sold_date', 'has_movements'],
  )

  // ── 2. The opposite: on the shelf in the system, but sold ──────────────
  section(
    'MARKED AVAILABLE, BUT A SALE NAMES THEM',
    'These are billed to someone. If they are still on the shelf the sale was never delivered; if they are gone, the status lies.',
    await q(`
      SELECT s.serial_number, pr.name AS product, s.status, s.location, i.invoice_number, c.name AS customer
        FROM serial_numbers s
        LEFT JOIN products pr ON pr.id = s.product_id
        LEFT JOIN invoices i ON i.id = s.sold_via_invoice_id
        LEFT JOIN clients c ON c.id = i.client_id
       WHERE s.removed_at IS NULL
         AND s.status IN ('in_stock', 'available')
         AND ${SOLD_EVIDENCE}
       ORDER BY s.updated_at DESC
       LIMIT ${limit}`),
    ['serial_number', 'product', 'status', 'location', 'invoice_number', 'customer'],
  )

  // ── 3. The same machine entered twice ──────────────────────────────────
  section(
    'THE SAME SERIAL ENTERED MORE THAN ONCE',
    'Ignoring case, spaces and punctuation. One of each pair is the real unit; the other usually has no documents behind it.',
    await q(`
      SELECT ${NORMALISED} AS normalised,
             count(*) AS rows,
             string_agg(s.serial_number || ' [' || s.status || ']', ' | ' ORDER BY s.created_at) AS entries,
             count(*) FILTER (WHERE ${SOLD_EVIDENCE}) AS with_a_sale
        FROM serial_numbers s
       WHERE s.removed_at IS NULL
       GROUP BY 1
      HAVING count(*) > 1
       ORDER BY count(*) DESC
       LIMIT ${limit}`),
    ['normalised', 'rows', 'entries', 'with_a_sale'],
  )

  // ── 4. Units whose product is gone ─────────────────────────────────────
  section(
    'UNITS WHOSE PRODUCT RECORD IS MISSING',
    'The catalogue row behind the unit was deleted or never created. These cannot be priced, counted by product, or saved to the serials table.',
    await q(`
      SELECT s.serial_number, s.product_id, s.status, s.location
        FROM serial_numbers s
        LEFT JOIN products pr ON pr.id = s.product_id
       WHERE s.removed_at IS NULL AND pr.id IS NULL
       LIMIT ${limit}`),
    ['serial_number', 'product_id', 'status', 'location'],
  )

  // ── 5. In the working list, never saved to the table ───────────────────
  section(
    'IN THE SCREENS’ LIST BUT NOT IN THE SERIALS TABLE',
    'The save could not place these rows. They exist only in the shared-state copy, so reports and stock counts do not see them.',
    await q(`
      SELECT r.payload->>'serial' AS serial, r.payload->>'productName' AS product,
             r.payload->>'status' AS status, r.payload->>'location' AS location,
             (SELECT count(*) FROM products p WHERE p.id::text = r.payload->>'productId') AS product_rows
        FROM erp_state_records r
       WHERE r.key = 'deed_serials'
         AND NOT EXISTS (
               SELECT 1 FROM serial_numbers t
                WHERE t.serial_number = btrim(coalesce(r.payload->>'serial', r.payload->>'serialNumber', '')))
       LIMIT ${limit}`),
    ['serial', 'product', 'status', 'location', 'product_rows'],
  )

  // ── 6. The catalogue behind them ───────────────────────────────────────
  section(
    'PRODUCTS THAT LOOK LIKE DUPLICATES',
    'Same name once case and spacing are ignored. Units split across them count and price separately.',
    await q(`
      SELECT lower(regexp_replace(p.name, '\\s+', ' ', 'g')) AS name,
             count(*) AS products,
             string_agg(p.sku, ' | ' ORDER BY p.sku) AS skus,
             sum((SELECT count(*) FROM serial_numbers s WHERE s.product_id = p.id AND s.removed_at IS NULL)) AS units
        FROM products p
       GROUP BY 1
      HAVING count(*) > 1
       ORDER BY count(*) DESC, 4 DESC
       LIMIT ${limit}`),
    ['name', 'products', 'skus', 'units'],
  )

  // ── 7. What the shelves should hold ────────────────────────────────────
  section(
    'WHAT THE SYSTEM BELIEVES IS ON HAND, BY LOCATION',
    'The starting sheet for a physical count: walk each location and compare.',
    await q(`
      SELECT coalesce(s.location, '(none)') AS location, s.status, count(*) AS units
        FROM serial_numbers s
       WHERE s.removed_at IS NULL
       GROUP BY 1, 2
       ORDER BY 1, 3 DESC`),
    ['location', 'status', 'units'],
  )

  if (asJson) {
    console.log(JSON.stringify(sections, null, 2))
    return
  }

  const [totals] = await q(`
    SELECT (SELECT count(*) FROM serial_numbers WHERE removed_at IS NULL) AS units,
           (SELECT count(*) FROM products) AS products`)
  console.log('')
  console.log(`INVENTORY HEALTH  ·  ${totals?.units ?? '?'} units on record  ·  ${totals?.products ?? '?'} products`)

  for (const s of sections) {
    console.log('')
    console.log(`${s.title}  (${s.rows.length}${s.rows.length === limit ? '+, capped' : ''})`)
    console.log(`  ${s.note}`)
    if (!s.rows.length) { console.log('  — nothing found.'); continue }
    const widths = s.columns.map(c => Math.min(44, Math.max(c.length, ...s.rows.map(r => String(r[c] ?? '').length))))
    console.log('  ' + s.columns.map((c, i) => pad(c.toUpperCase(), widths[i])).join('  '))
    console.log('  ' + widths.map(w => '-'.repeat(w)).join('  '))
    for (const row of s.rows) {
      console.log('  ' + s.columns.map((c, i) => pad(c.endsWith('_at') || c.endsWith('date') ? day(row[c]) : row[c], widths[i])).join('  '))
    }
  }
  console.log('')
  console.log('Nothing was changed. Each section is a decision, not a fix.')
  console.log('')
}

;(serialArg ? oneSerial(serialArg) : report())
  .catch(err => { console.error(`ERROR: ${err.message}`); process.exitCode = 1 })
  .finally(() => pool.end())
