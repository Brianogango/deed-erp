#!/usr/bin/env node
/**
 * Realign purchase-order ids between the blob store and Prisma.
 *
 * POs created blob-first and later re-created through the Prisma API ended
 * up with two ids: the blob original and the Prisma row. Bills/GRNs linking
 * the blob id then fail FK checks at posting. For each blob PO:
 *
 *   - id exists in Prisma → nothing to do.
 *   - po_number exists in Prisma under a different id → repoint every blob
 *     reference (invoices, receipts, returns, …) to the Prisma id and rewrite
 *     the blob PO's id (or drop it when a twin entry already exists).
 *   - neither → create the PO in Prisma under the blob id.
 *
 * Idempotent. Run --dry-run first.
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

const readBlob = async (key) => {
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = $1`, [key])
  if (!rows.length) return []
  return JSON.parse(typeof rows[0].value === 'string' ? rows[0].value : JSON.stringify(rows[0].value))
}

const blobPOs = await readBlob('deed_purchaseOrders')
const { rows: prismaPOs } = await pool.query(`SELECT id, po_number FROM purchase_orders`)
const prismaById = new Map(prismaPOs.map(p => [p.id, p]))
const prismaByNumber = new Map(prismaPOs.map(p => [p.po_number, p]))

const { rows: userRows } = await pool.query(`SELECT id FROM users WHERE is_active ORDER BY created_at ASC LIMIT 1`)
const fallbackUser = userRows[0]?.id

let twins = 0
let created = 0
const repoint = new Map() // blobId -> prismaId

for (const po of blobPOs) {
  const id = String(po?.id ?? '')
  const ref = String(po?.ref ?? po?.poNumber ?? '').trim()
  if (!id) continue
  if (prismaById.has(id)) continue
  const twin = ref ? prismaByNumber.get(ref) : null
  if (twin) {
    repoint.set(id, twin.id)
    twins++
    continue
  }
  // Create in Prisma under the blob id.
  const vendorName = String(po.vendorName ?? '')
  let clientId = null
  if (po.vendorId) {
    const r = await pool.query(`SELECT id FROM clients WHERE id = $1`, [po.vendorId])
    clientId = r.rows[0]?.id ?? null
  }
  if (!clientId && vendorName) {
    const r = await pool.query(`SELECT id FROM clients WHERE lower(name) = lower($1) LIMIT 1`, [vendorName])
    clientId = r.rows[0]?.id ?? null
  }
  if (!clientId) {
    const r = await pool.query(
      `INSERT INTO clients (id, client_number, name, client_type, is_vendor, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), 'CLT-' || lpad(floor(random()*90000+10000)::text, 5, '0'), $1, 'company', true, true, NOW(), NOW())
       RETURNING id`,
      [vendorName || 'Unknown Vendor'],
    )
    clientId = r.rows[0].id
  }
  const lines = (Array.isArray(po.lines) ? po.lines : []).filter(l => l.productId)
  console.log(`CREATE ${ref || id} (${vendorName}) — ${lines.length} line(s)`)
  if (!DRY) {
    await pool.query('BEGIN')
    try {
      await pool.query(
        `INSERT INTO purchase_orders (id, po_number, client_id, status, order_date, expected_date, subtotal, tax_amount, total_amount, notes, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
        [
          id,
          ref || `PO-${id.slice(0, 8)}`,
          clientId,
          String(po.status ?? 'draft'),
          po.date ? new Date(po.date) : new Date(),
          po.expectedDate ? new Date(po.expectedDate) : null,
          Math.max(0, Number(po.subtotal) || 0),
          Math.max(0, Number(po.taxTotal ?? po.taxAmount) || 0),
          Math.max(0, Number(po.total ?? po.totalAmount) || 0),
          po.notes ? String(po.notes) : null,
          fallbackUser,
        ],
      )
      for (const l of lines) {
        const productId = String(l.productId)
        const pExists = await pool.query(`SELECT id FROM products WHERE id = $1`, [productId])
        if (!pExists.rows.length) {
          console.log(`  ! product ${productId} (${l.productName || '?'}) missing in Prisma — line skipped`)
          continue
        }
        await pool.query(
          `INSERT INTO purchase_order_items (id, po_id, product_id, description, qty_ordered, qty_received, qty_billed, unit_cost, tax_rate, line_total, account_code)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            productId,
            String(l.productName ?? l.description ?? '').slice(0, 2000) || null,
            Math.max(0, Math.floor(Number(l.qty) || 0)),
            Math.max(0, Math.floor(Number(l.qtyReceived) || 0)),
            Math.max(0, Math.floor(Number(l.qtyBilled) || 0)),
            Math.max(0, Number(l.unitPrice) || 0),
            Math.max(0, Number(l.taxRate) || 0),
            Math.max(0, Number(l.subtotal) || 0),
            l.accountCode ?? null,
          ],
        )
      }
      await pool.query('COMMIT')
      created++
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }
  }
}

// Repoint blob references + rewrite/dedupe the blob PO list.
if (repoint.size > 0) {
  console.log(`Repointing ${repoint.size} twin PO id(s):`)
  for (const [from, to] of repoint) console.log(`  ${from} → ${to}`)
  if (!DRY) {
    const { rows: stateRows } = await pool.query(`SELECT key, value FROM app_state`)
    for (const row of stateRows) {
      let text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value)
      let touched = false
      for (const [from, to] of repoint) {
        if (text.includes(from)) {
          text = text.split(from).join(to)
          touched = true
        }
      }
      if (!touched) continue
      if (row.key === 'deed_purchaseOrders') {
        try {
          const arr = JSON.parse(text)
          if (Array.isArray(arr)) {
            const seen = new Set()
            text = JSON.stringify(arr.filter(p => {
              const pid = String(p?.id ?? '')
              if (!pid || seen.has(pid)) return false
              seen.add(pid)
              return true
            }))
          }
        } catch { /* keep textual result */ }
      }
      await pool.query(`UPDATE app_state SET value = $1, updated_at = NOW() WHERE key = $2`, [text, row.key])
      console.log(`  blob ${row.key}: repointed`)
    }
  }
}

console.log(`POs: ${twins} twin(s) repointed, ${created} created in Prisma, ${blobPOs.length} blob rows scanned`)
if (DRY) console.log('DRY RUN — nothing written.')
await pool.end()
