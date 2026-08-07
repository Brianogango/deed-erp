#!/usr/bin/env node
/**
 * Ops helper: backfill removal records + returned stock for a completed
 * Device Reconfiguration work order whose ORIGINAL configuration was never
 * captured anywhere in the system (no DeviceConfigurationSnapshot, no
 * DeviceComponentInstallation rows, and an empty serial.specs) before the
 * reconfiguration ran.
 *
 * Root cause: lib/reconfiguration/diff-engine.ts's calculateConfigurationDiff
 * only computes a `removals` entry for a component that is tracked as an
 * `installed` DeviceComponentInstallation row. When a device has none (its
 * only "spec" was free text baked into the shared catalog Product's name,
 * never recorded on the serial itself), the diff engine cannot tell "this
 * device genuinely has 0GB RAM" apart from "this device's RAM was never
 * recorded" — it silently treats the change as an ADDITIVE install with no
 * removal, so a real physical part that a technician took out of the
 * device is never logged anywhere and never returns to inventory stock.
 *
 * This script creates the missing audit trail for ONE already-completed
 * work order:
 *   1. A `removed` DeviceComponentInstallation row for each old component
 *      (so the device's install history is complete).
 *   2. A ReconfigurationRemovalLine row referencing it (destination:
 *      pending_testing — matches lib/reconfiguration/service.ts's
 *      applyStockPlan default for return_bulk_to_testing).
 *   3. +1 unit of bulk stock at pending_testing for the removed product
 *      (deed_bulkStock blob + deed_products.stockQty display field +
 *      Prisma stock_levels.qty_on_hand), plus a deed_stockMoves audit row
 *      referencing the work order.
 *
 * Idempotent: skips a component if a ReconfigurationRemovalLine already
 * exists for (work order, component product) — safe to re-run.
 *
 *   node scripts/backfill-reconfiguration-removals.mjs --dry-run
 *   node scripts/backfill-reconfiguration-removals.mjs
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

// The single completed work order affected by this gap (RCF/2026/0001,
// serial 5CG023BRNR, "HP EliteBook 745 G6" downgrade 16GB/512GB → 8GB/256GB).
const WORK_ORDER_ID = 'f0077c51-b89d-42fc-9ced-8c62887042b8'
const SERIAL_ID = '2b494a85-4ed9-4d82-bd9a-6c0642e23d66'

const REMOVED_COMPONENTS = [
  {
    componentProductId: '5c02d96d-a66a-43a3-bfaf-92457d5c8a0f', // 16GB DDR4 SODIMM Laptop RAM - 3200MHz
    productName: '16GB DDR4 SODIMM Laptop RAM - 3200MHz',
    category: 'ram',
    slotType: 'ram_slot',
    slotNumber: 1,
    capacityGb: 16,
    dataStatus: null,
  },
  {
    componentProductId: '24db18cd-810f-4ddb-b5e1-495a4dd4b78b', // 512GB NVMe SSD - M.2 2280 PCIe
    productName: '512GB NVMe SSD - M.2 2280 PCIe',
    category: 'storage',
    slotType: 'm2_slot',
    slotNumber: 1,
    capacityGb: 512,
    // Mirrors diff-engine.ts's storage_data_handling issue: removed storage
    // needs a data-status confirmation/sanitisation before it can go back to
    // sellable stock — it lands in pending_testing, not warehouse/shop.
    dataStatus: 'unknown',
  },
]

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
  const client = await pool.connect()
  try {
    const wo = await client.query(
      `SELECT id, ref, status FROM reconfiguration_work_orders WHERE id = $1`,
      [WORK_ORDER_ID],
    )
    if (!wo.rows[0]) {
      console.error(`ERROR: work order ${WORK_ORDER_ID} not found`)
      process.exitCode = 1
      return
    }
    console.log(`Work order ${wo.rows[0].ref} status=${wo.rows[0].status}`)

    await client.query('BEGIN')

    const bulkStock = await loadJsonArray(client, 'deed_bulkStock')
    const stockMoves = await loadJsonArray(client, 'deed_stockMoves')
    const products = await loadJsonArray(client, 'deed_products')

    let bulkStockChanged = false
    let productsChanged = false
    let stockMovesChanged = false
    let created = 0
    let skipped = 0

    for (const comp of REMOVED_COMPONENTS) {
      const existingLine = await client.query(
        `SELECT id FROM reconfiguration_removal_lines
         WHERE work_order_id = $1 AND component_product_id = $2`,
        [WORK_ORDER_ID, comp.componentProductId],
      )
      if (existingLine.rows.length > 0) {
        console.log(`SKIP ${comp.productName} — removal line already recorded (${existingLine.rows[0].id})`)
        skipped += 1
        continue
      }

      console.log(`Backfilling removal for ${comp.productName} (${comp.componentProductId})`)

      const installationId = randomUUID()
      const removalLineId = randomUUID()
      const moveId = `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now = new Date().toISOString()

      if (!dryRun) {
        await client.query(
          `INSERT INTO device_component_installations
             (id, serial_id, component_product_id, category, slot_type, slot_number,
              capacity_gb, quantity, removable, status, installed_at, removed_at,
              removal_work_order_id, cost_at_installation, version, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, true, 'removed', $8, $8, $9, 0, 1, now(), now())`,
          [installationId, SERIAL_ID, comp.componentProductId, comp.category, comp.slotType,
            comp.slotNumber, comp.capacityGb, now, WORK_ORDER_ID],
        )

        await client.query(
          `INSERT INTO reconfiguration_removal_lines
             (id, work_order_id, installation_id, component_product_id, slot_type, slot_number,
              quantity, existing_cost, destination_location, disposition, data_status, qa_status,
              actual_removed_at, stock_move_ref, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 1, 0, 'pending_testing', 'pending_testing', $7, 'pending', $8, $9, now())`,
          [removalLineId, WORK_ORDER_ID, installationId, comp.componentProductId, comp.slotType,
            comp.slotNumber, comp.dataStatus, now, moveId],
        )
      }

      const idx = bulkStock.findIndex(b => b.productId === comp.componentProductId && b.location === 'pending_testing')
      if (idx >= 0) bulkStock[idx] = { ...bulkStock[idx], qty: (Number(bulkStock[idx].qty) || 0) + 1 }
      else bulkStock.push({ productId: comp.componentProductId, location: 'pending_testing', qty: 1 })
      bulkStockChanged = true

      const pIdx = products.findIndex(p => p.id === comp.componentProductId)
      if (pIdx >= 0) {
        products[pIdx] = { ...products[pIdx], stockQty: Math.max(0, Number(products[pIdx].stockQty ?? 0) + 1) }
        productsChanged = true
      }

      stockMoves.push({
        id: moveId,
        type: 'in',
        productId: comp.componentProductId,
        productName: comp.productName,
        qty: 1,
        toLocation: 'pending_testing',
        documentRef: 'RCF/2026/0001',
        date: now,
        userId: 'system',
        notes:
          'Removed during RCF/2026/0001 — backfilled: original device configuration ' +
          '(16GB RAM, 512GB SSD) was never captured as tracked installed components, ' +
          'so the reconfiguration workflow could not auto-return this part to stock. ' +
          'Physical part needs QA/data-sanitisation before moving to sellable stock.',
      })
      stockMovesChanged = true

      if (!dryRun) {
        const level = await client.query(`SELECT id, qty_on_hand FROM stock_levels WHERE product_id = $1`, [comp.componentProductId])
        if (level.rows[0]) {
          await client.query(`UPDATE stock_levels SET qty_on_hand = qty_on_hand + 1, updated_at = now() WHERE product_id = $1`, [comp.componentProductId])
        } else {
          await client.query(
            `INSERT INTO stock_levels (id, product_id, qty_on_hand, qty_reserved, qty_on_order, updated_at)
             VALUES ($1, $2, 1, 0, 0, now())`,
            [randomUUID(), comp.componentProductId],
          )
        }
      }

      created += 1
    }

    if (dryRun) {
      console.log(`[dry-run] Would create ${created} removal record(s), skip ${skipped}; would touch deed_bulkStock/deed_products/deed_stockMoves + stock_levels`)
      await client.query('ROLLBACK')
      return
    }

    if (bulkStockChanged) await saveJsonArray(client, 'deed_bulkStock', bulkStock)
    if (productsChanged) await saveJsonArray(client, 'deed_products', products)
    if (stockMovesChanged) await saveJsonArray(client, 'deed_stockMoves', stockMoves)

    await client.query('COMMIT')
    console.log(`OK: created ${created} removal record(s), skipped ${skipped} (already recorded)`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
