#!/usr/bin/env node
/**
 * Converge twin purchase orders: the Prisma row's id becomes the blob id.
 *
 * Blob-first POs re-created through the API diverged (blob id ≠ Prisma id).
 * Repointing blob references to the Prisma id did not hold — stale clients
 * re-write the blob id back. The durable fix is the inverse: re-id the
 * Prisma row to the blob id (FK-safe, deferred constraints), merge the blob
 * entries, and repoint any lingering Prisma-id references in the blob.
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

const FK_COLUMNS = [
  ['goods_received_notes', 'po_id'],
  ['purchase_order_items', 'po_id'],
  ['supplier_payments', 'po_id'],
  ['inventory_batches', 'purchase_order_id'],
  ['invoices', 'purchase_order_id'],
]

const { rows: stateRows } = await pool.query(`SELECT value FROM app_state WHERE key = 'deed_purchaseOrders'`)
const blobPOs = stateRows.length
  ? JSON.parse(typeof stateRows[0].value === 'string' ? stateRows[0].value : JSON.stringify(stateRows[0].value))
  : []
const { rows: prismaPOs } = await pool.query(`SELECT id, po_number FROM purchase_orders`)
const prismaByNumber = new Map(prismaPOs.map(p => [p.po_number, p.id]))

// Twin pairs: blob id B ≠ Prisma id P for the same po_number.
const pairs = []
for (const po of blobPOs) {
  const blobId = String(po?.id ?? '')
  const ref = String(po?.ref ?? po?.poNumber ?? '').trim()
  if (!blobId || !ref) continue
  const prismaId = prismaByNumber.get(ref)
  if (prismaId && prismaId !== blobId) pairs.push({ blobId, prismaId, ref })
}

console.log(`${pairs.length} twin pair(s) to converge (Prisma id → blob id)`)
for (const p of pairs) console.log(`  ${p.ref}: ${p.prismaId} → ${p.blobId}`)

  if (!DRY) {
    for (const { blobId, prismaId, ref } of pairs) {
      await pool.query('BEGIN')
      try {
        // Free the unique po_number first, then copy the row onto the blob
        // id, move the children, and drop the old Prisma-id row.
        const tempNumber = `__MERGE_${prismaId.slice(0, 8)}`
        await pool.query(`UPDATE purchase_orders SET po_number = $1 WHERE id = $2`, [tempNumber, prismaId])
        await pool.query(
          `INSERT INTO purchase_orders (id, po_number, supplier_id, client_id, status, order_date, expected_date, delivery_address, subtotal, tax_amount, discount_amount, total_amount, amount_paid, notes, internal_notes, approved_by, approved_at, lock_version, created_by, created_at, updated_at)
           SELECT $1, $3, supplier_id, client_id, status, order_date, expected_date, delivery_address, subtotal, tax_amount, discount_amount, total_amount, amount_paid, notes, internal_notes, approved_by, approved_at, lock_version, created_by, created_at, NOW()
           FROM purchase_orders WHERE id = $2`,
          [blobId, prismaId, ref],
        )
        for (const [table, col] of FK_COLUMNS) {
          await pool.query(`UPDATE "${table}" SET "${col}" = $1 WHERE "${col}" = $2`, [blobId, prismaId])
        }
        await pool.query(`DELETE FROM purchase_orders WHERE id = $1`, [prismaId])
        await pool.query('COMMIT')
        console.log(`  converged ${ref}`)
      } catch (err) {
        await pool.query('ROLLBACK')
        throw err
      }
    }

  // Blob: merge twin entries to the blob id + repoint lingering Prisma-id refs.
  const { rows: allState } = await pool.query(`SELECT key, value FROM app_state`)
  for (const row of allState) {
    let text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value)
    let touched = false
    for (const { blobId, prismaId } of pairs) {
      if (text.includes(prismaId)) {
        text = text.split(prismaId).join(blobId)
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
  }
  console.log('  blob references repointed + deduped')
}

console.log(`converged ${DRY ? 0 : pairs.length} PO id pair(s)`)
if (DRY) console.log('DRY RUN — nothing written.')
await pool.end()
