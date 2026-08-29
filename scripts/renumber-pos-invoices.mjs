#!/usr/bin/env node
/**
 * Ops helper: renumber POS-sale invoices from INV/2026/NNNN to their till-ticket
 * number (POS/NNNN), so POS sales show as POS sales everywhere instead of looking
 * like regular invoices.
 *
 * New POS sales already use the POS ticket number (store.tsx createPOSOrder).
 * This script renumbers the historical ones created before that fix.
 *
 * Updates:
 *   - blob deed_invoices[].ref            INV/... → POS/NNNN
 *   - blob deed_posOrders[].invoiceRef    INV/... → POS/NNNN
 *   - Prisma invoices.invoice_number      INV/... → POS/NNNN
 *
 * GL journals are untouched: they link via source_id (the stable invoice id),
 * not the human-readable number.
 *
 *   node scripts/renumber-pos-invoices.mjs          # dry-run (default)
 *   node scripts/renumber-pos-invoices.mjs --apply
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
function loadEnvFile(fp) {
  if (!existsSync(fp)) return
  for (const line of readFileSync(fp, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq <= 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
loadEnvFile(resolve(ROOT, '.env')); loadEnvFile(resolve(ROOT, '.env.local'))

const APPLY = process.argv.includes('--apply')
const cs = process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!cs) { console.error('ERROR: DATABASE_URL / POSTGRES_URL is not set'); process.exit(1) }

const pool = new Pool({ connectionString: cs })
const client = await pool.connect()

async function loadJson(key) {
  const { rows } = await client.query('SELECT value FROM app_state WHERE key = $1', [key])
  if (!rows.length) return []
  try { return JSON.parse(rows[0].value) } catch { return [] }
}
async function saveJson(key, value) {
  await client.query(
    'INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
    [key, JSON.stringify(value)],
  )
}

try {
  const orders = await loadJson('deed_posOrders')
  const invoices = await loadJson('deed_invoices')
  const invById = new Map(invoices.map((i) => [i.id, i]))
  const invByRef = new Map(invoices.map((i) => [i.ref, i]))

  // POS orders whose linked invoice still carries an INV number.
  const toFix = []
  for (const o of orders) {
    const inv = invById.get(o.invoiceId) || invByRef.get(o.invoiceRef)
    if (!inv) continue
    if (inv.ref === o.ref) continue // already POS-numbered
    if (!/^POS\/\d+$/.test(o.ref)) continue // order ref isn't a POS ticket number
    toFix.push({ order: o, inv, oldRef: inv.ref, newRef: o.ref })
  }

  console.log(`POS orders scanned: ${orders.length}`)
  console.log(`POS invoices to renumber: ${toFix.length}`)
  toFix.slice(0, 30).forEach((t) => console.log(`  ${t.oldRef}  →  ${t.newRef}`))

  // Guard: new number must not collide with a different invoice.
  const refOwner = new Map(invoices.map((i) => [i.ref, i.id]))
  const collisions = toFix.filter((t) => refOwner.has(t.newRef) && refOwner.get(t.newRef) !== t.inv.id)
  if (collisions.length) {
    console.error(`ABORT: ${collisions.length} target POS numbers already used by another invoice:`)
    collisions.forEach((c) => console.error(`  ${c.newRef} (wanted for ${c.oldRef})`))
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\nDry-run. Re-run with --apply to renumber.')
  } else if (toFix.length) {
    await client.query('BEGIN')
    // Blob invoices
    const newInvoices = invoices.map((i) => {
      const fix = toFix.find((t) => t.inv.id === i.id)
      return fix ? { ...i, ref: fix.newRef } : i
    })
    // Blob POS orders
    const newOrders = orders.map((o) => {
      const fix = toFix.find((t) => t.order.id === o.id)
      return fix ? { ...o, invoiceRef: fix.newRef } : o
    })
    await saveJson('deed_invoices', newInvoices)
    await saveJson('deed_posOrders', newOrders)
    // Prisma invoices
    for (const t of toFix) {
      await client.query('UPDATE invoices SET invoice_number = $1 WHERE id = $2', [t.newRef, t.inv.id])
    }
    await client.query('COMMIT')
    console.log(`\nRenumbered ${toFix.length} POS invoices.`)
  }
} catch (e) {
  try { await client.query('ROLLBACK') } catch { /* noop */ }
  console.error('ERROR:', e.message)
  process.exitCode = 1
} finally {
  client.release(); await pool.end()
}
