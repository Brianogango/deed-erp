#!/usr/bin/env node
/**
 * One-off heal: PO/2026/0087 (Elevetus, 3× Lenovo V14 G5) never reached
 * Prisma — when it was first synced, the Lenovo product was missing and the
 * whole PO write died on a P2003 FK violation. The bill for it therefore
 * cannot post. Inserts the PO + its line with the same ids. Idempotent.
 *
 *   node scripts/heal-po-2026-0087.mjs --dry-run
 *   node scripts/heal-po-2026-0087.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DRY = process.argv.includes('--dry-run')

for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq <= 0) continue
  const key = t.slice(0, eq).trim()
  let value = t.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  if (!(key in process.env)) process.env[key] = value
}

const pool = new Pool({ connectionString: process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL })

const PO_ID = 'd83fbb24-5e88-48ba-afb8-fd0c37069880'
const CLIENT_ID = '257d991e-fd32-4c2a-8c27-98dfac0f883e' // Elevetus Technologies Limited Group
const PRODUCT_ID = '3fb6e6db-c5d0-4411-a661-59d387b1123b' // Lenovo V14 G5
const CREATED_BY = '5ebd35f4-2181-4bf3-96d1-00298589987b' // brian

const { rows: existing } = await pool.query(`SELECT id FROM purchase_orders WHERE id = $1 OR po_number = 'PO/2026/0087'`, [PO_ID])
if (existing.length) {
  console.log('PO already present in Prisma — nothing to do.')
  await pool.end()
  process.exit(0)
}

const { rows: checks } = await pool.query(
  `SELECT (SELECT count(*) FROM clients WHERE id = $1) AS client_ok, (SELECT count(*) FROM products WHERE id = $2) AS product_ok, (SELECT count(*) FROM users WHERE id = $3) AS user_ok`,
  [CLIENT_ID, PRODUCT_ID, CREATED_BY],
)
if (!checks[0].client_ok || !checks[0].product_ok || !checks[0].user_ok) {
  console.error('FK targets missing:', checks[0])
  await pool.end()
  process.exit(2)
}

console.log('Inserting PO/2026/0087 (Elevetus, 3× Lenovo V14 G5 @ 74,500) into Prisma…')
if (!DRY) {
  await pool.query('BEGIN')
  try {
    await pool.query(
      `INSERT INTO purchase_orders (id, po_number, client_id, status, order_date, subtotal, tax_amount, total_amount, created_by, created_at, updated_at)
       VALUES ($1, 'PO/2026/0087', $2, 'received', '2026-08-28', 223500, 0, 223500, $3, NOW(), NOW())`,
      [PO_ID, CLIENT_ID, CREATED_BY],
    )
    await pool.query(
      `INSERT INTO purchase_order_items (id, po_id, product_id, description, qty_ordered, qty_received, qty_billed, unit_cost, tax_rate, line_total, account_code)
       VALUES (gen_random_uuid(), $1, $2, 'Lenovo V14 G5 IRL — i5-13420H, 8GB DDR5, 512GB SSD (see product master)', 3, 3, 0, 74500, 0, 223500, '6101')`,
      [PO_ID, PRODUCT_ID],
    )
    await pool.query('COMMIT')
    console.log('PO healed. qty_billed starts at 0 — the bill post advances it to 3.')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
} else {
  console.log('DRY RUN — nothing written.')
}
await pool.end()
