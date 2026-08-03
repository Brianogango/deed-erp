#!/usr/bin/env node
/**
 * Ops helper: diagnose / heal missing deed_serials after a vendor bill GRN.
 *
 * Root cause pattern: GRN validation marked PO qtyReceived and saved serials on
 * the receipt, but concurrent POST /api/serials read-modify-writes dropped units
 * from deed_serials — so Available qty shows 0 and sales need manual serial entry.
 *
 *   node scripts/heal-grn-serials.mjs --bill BILL/0089
 *   node scripts/heal-grn-serials.mjs --bill BILL/0089 --heal
 *   node scripts/heal-grn-serials.mjs --bill BILL/0089 --heal --dry-run
 *   node scripts/heal-grn-serials.mjs --po PO/2026/0012 --heal
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
  const seed = String(manufacturerSerial ?? '').trim()
    || String(productSku ?? '').trim()
    || 'ITEM'
  if (!existing.has(seed.toUpperCase())) return seed
  let counter = 2
  while (true) {
    const candidate = `${seed}-${counter}`
    if (!existing.has(candidate.toUpperCase())) return candidate
    counter += 1
  }
}

const billRef = String(arg('--bill', '')).trim()
const poRefArg = String(arg('--po', '')).trim()
const heal = process.argv.includes('--heal')
const dryRun = process.argv.includes('--dry-run')

if (!billRef && !poRefArg) fail('Pass --bill BILL/0089 or --po PO/...')

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
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
  const client = await pool.connect()
  try {
    const invoices = await loadJsonArray(client, 'deed_invoices')
    const purchaseOrders = await loadJsonArray(client, 'deed_purchaseOrders')
    const receipts = await loadJsonArray(client, 'deed_receipts')
    let serials = await loadJsonArray(client, 'deed_serials')
    let products = await loadJsonArray(client, 'deed_products')

    let po = null
    let bill = null

    if (billRef) {
      bill = invoices.find(inv =>
        String(inv?.ref ?? '').toUpperCase() === billRef.toUpperCase()
        && inv?.type === 'vendor_bill',
      )
      if (!bill) fail(`Vendor bill ${billRef} not found in deed_invoices`)
      console.log(`Bill: ${bill.ref} · vendor=${bill.partnerName} · total=${bill.total} · status=${bill.status}`)
      console.log(`  purchaseOrderId=${bill.purchaseOrderId ?? '(none)'}`)
      if (!bill.purchaseOrderId) fail('Bill has no purchaseOrderId — cannot locate GRN')
      po = purchaseOrders.find(p => p.id === bill.purchaseOrderId)
      if (!po) fail(`PO id ${bill.purchaseOrderId} not found`)
    } else {
      po = purchaseOrders.find(p => String(p?.ref ?? '').toUpperCase() === poRefArg.toUpperCase())
      if (!po) fail(`PO ${poRefArg} not found`)
    }

    console.log(`PO: ${po.ref} · vendor=${po.vendorName} · status=${po.status}`)
    for (const line of po.lines ?? []) {
      console.log(
        `  line ${line.productName}: qty=${line.qty} received=${line.qtyReceived ?? 0}`
        + ` billed=${line.qtyBilled ?? 0} serial=${Boolean(line.requiresSerial)}`
        + ` productId=${line.productId}`,
      )
    }

    const poReceipts = receipts.filter(r => r.poId === po.id)
    console.log(`Receipts linked to PO: ${poReceipts.length}`)
    for (const r of poReceipts) {
      const serialCount = (r.lines ?? []).reduce((a, l) => a + (Array.isArray(l.serials) ? l.serials.length : 0), 0)
      console.log(
        `  ${r.ref} status=${r.status} dest=${r.destinationLocation ?? '?'} `
        + `lines=${(r.lines ?? []).length} serialsOnLines=${serialCount}`,
      )
    }

    const validated = poReceipts.filter(r => r.status === 'validated')
    if (validated.length === 0) {
      fail('No validated GRN for this PO — stock was never confirmed into inventory')
    }

    /** @type {{ serial: string, productId: string, productName: string, receiptId: string, receiptRef: string, location: string }[]} */
    const expected = []
    for (const receipt of validated) {
      const dest = String(receipt.destinationLocation || 'warehouse')
      for (const line of receipt.lines ?? []) {
        if (!line.requiresSerial) continue
        const list = Array.isArray(line.serials) ? line.serials : []
        for (const raw of list) {
          const serial = String(raw ?? '').trim()
          if (!serial) continue
          expected.push({
            serial,
            productId: String(line.productId),
            productName: String(line.productName ?? ''),
            receiptId: receipt.id,
            receiptRef: receipt.ref,
            location: dest,
          })
        }
      }
    }

    console.log(`\nExpected serials from validated GRN lines: ${expected.length}`)
    if (expected.length === 0) {
      fail(
        'Validated GRN has no serials on receipt lines. '
        + 'Cannot heal automatically — re-enter serials via inventory intake or GRN correction.',
      )
    }

    const bySerial = new Map(
      serials.map(s => [String(s?.serial ?? '').toLowerCase(), s]),
    )

    const missing = []
    const present = []
    const wrongProduct = []
    for (const row of expected) {
      const existing = bySerial.get(row.serial.toLowerCase())
      if (!existing) {
        missing.push(row)
        continue
      }
      if (String(existing.productId) !== row.productId) {
        wrongProduct.push({ ...row, existingProductId: existing.productId, status: existing.status })
      } else {
        present.push({ ...row, status: existing.status, location: existing.location })
      }
    }

    console.log(`Present in deed_serials: ${present.length}`)
    console.log(`Missing from deed_serials: ${missing.length}`)
    if (wrongProduct.length) {
      console.log(`Wrong productId on existing serial: ${wrongProduct.length}`)
      for (const w of wrongProduct) {
        console.log(`  ${w.serial}: expected product ${w.productId}, found ${w.existingProductId} (${w.status})`)
      }
    }

    // Per-product availability snapshot
    const productIds = [...new Set(expected.map(e => e.productId))]
    console.log('\nProduct stock snapshot (serial-tracked Available/Assigned/etc.):')
    for (const productId of productIds) {
      const prod = products.find(p => p.id === productId)
      const name = prod?.name || expected.find(e => e.productId === productId)?.productName || productId
      const active = serials.filter(s =>
        s.productId === productId
        && ['available', 'assigned', 'under_repair', 'refurbishment', 'in_stock'].includes(s.status),
      )
      const available = active.filter(s => s.status === 'available' || s.status === 'in_stock')
      console.log(
        `  ${name}`
        + `\n    requiresSerial=${Boolean(prod?.requiresSerial)} tracking=${prod?.trackingMethod ?? '?'}`
        + ` stockQty=${prod?.stockQty ?? '?'}`
        + `\n    activeSerials=${active.length} available=${available.length}`
        + ` expectedFromGrn=${expected.filter(e => e.productId === productId).length}`
        + ` missing=${missing.filter(m => m.productId === productId).length}`,
      )
    }

    if (!heal) {
      console.log('\nDiagnose only. Re-run with --heal to recreate missing serials from GRN lines.')
      return
    }

    if (missing.length === 0) {
      console.log('\nNothing to heal — all GRN serials already exist in deed_serials.')
      // Still ensure requiresSerial flags
    }

    const barcodes = serials.map(s => s.barcode)
    const toCreate = missing.map(row => {
      const prod = products.find(p => p.id === row.productId)
      const barcode = buildInventoryBarcode(
        barcodes,
        row.serial,
        prod?.sku || row.productId,
      )
      barcodes.push(barcode)
      return {
        id: randomUUID(),
        serial: row.serial,
        productId: row.productId,
        productName: row.productName || prod?.name || 'Product',
        sku: prod?.sku || undefined,
        location: row.location || 'warehouse',
        status: 'available',
        purchaseOrderId: po.id,
        receiptId: row.receiptId,
        receivedDate: todayLocal(),
        barcode,
        accessoryNotes: `Healed from GRN ${row.receiptRef} (${bill?.ref || po.ref})`,
      }
    })

    // Ensure products are serial-tracked so Available qty counts these units.
    const productPatches = new Map()
    for (const productId of productIds) {
      const idx = products.findIndex(p => p.id === productId)
      if (idx < 0) continue
      const prod = products[idx]
      const createdForProduct = toCreate.filter(s => s.productId === productId).length
      const next = {
        ...prod,
        requiresSerial: true,
        trackingMethod: 'SERIAL',
        stockQty: Number(prod.stockQty ?? 0) + createdForProduct,
      }
      const needsPatch =
        !prod.requiresSerial
        || String(prod.trackingMethod ?? '').toUpperCase() !== 'SERIAL'
        || createdForProduct > 0
      if (needsPatch) productPatches.set(productId, { idx, next, createdForProduct })
    }

    console.log(`\nWill create ${toCreate.length} missing serial(s); patch ${productPatches.size} product(s).`)
    for (const row of toCreate) {
      console.log(`  + ${row.serial} → ${row.productName} @ ${row.location} (${row.barcode})`)
    }

    if (dryRun) {
      console.log('Dry run — no write.')
      return
    }

    await client.query('BEGIN')
    try {
      if (toCreate.length > 0) {
        serials = [...toCreate, ...serials]
        await saveJsonArray(client, 'deed_serials', serials)
      }

      if (productPatches.size > 0) {
        const nextProducts = [...products]
        for (const { idx, next } of productPatches.values()) {
          nextProducts[idx] = next
        }
        products = nextProducts
        await saveJsonArray(client, 'deed_products', products)
      }

      for (const row of toCreate) {
        const prismaProduct = await client.query(`SELECT id FROM products WHERE id = $1`, [row.productId])
        if (!prismaProduct.rows[0]) continue
        await client.query(
          `UPDATE products
           SET tracking_method = 'SERIAL', track_stock = true, updated_at = NOW()
           WHERE id = $1::uuid AND tracking_method IS DISTINCT FROM 'SERIAL'`,
          [row.productId],
        )
        await client.query(
          `INSERT INTO serial_numbers
             (id, product_id, serial_number, inventory_barcode, status, notes, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, 'in_stock', $5, NOW(), NOW())
           ON CONFLICT (serial_number) DO NOTHING`,
          [row.id, row.productId, row.serial, row.barcode, row.accessoryNotes],
        )
      }

      await client.query('COMMIT')
      console.log(`OK healed ${toCreate.length} serial(s) for ${bill?.ref || po.ref}`)
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
