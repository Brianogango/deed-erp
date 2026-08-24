#!/usr/bin/env node
/**
 * Rewrite sale / invoice / delivery descriptions for completed device
 * reconfigurations that still show the intake catalog specs.
 *
 *   node scripts/repair-reconfig-document-specs.mjs --dry-run
 *   node scripts/repair-reconfig-document-specs.mjs
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

const DRY = process.argv.includes('--dry-run')
const STORAGE_CLAUSE = /(\d+(?:\.\d+)?)\s*(TB|GB)\s*(NVMe\s*)?(SSD|HDD|NVMe)\b/gi
const RAM_CLAUSE = /(\d+)\s*GB\s*(DDR\d?\s*)?RAM\b/gi

function storageTypeLabel(storageType) {
  const raw = String(storageType || 'SSD')
  if (/nvme/i.test(raw)) return 'NVMe'
  if (/hdd/i.test(raw)) return 'HDD'
  return 'SSD'
}

function formatStorageGb(gb, storageType) {
  const type = storageTypeLabel(storageType)
  if (gb >= 1024 && gb % 1024 === 0) return `${gb / 1024}TB ${type}`
  return `${gb}GB ${type}`
}

function rewriteUnitCapacitiesInText(text, ramGb, storageGb, storageType) {
  let out = String(text || '').replace(/\s+/g, ' ').trim()
  if (!out) return out
  if (storageGb > 0) {
    STORAGE_CLAUSE.lastIndex = 0
    if (STORAGE_CLAUSE.test(out)) {
      STORAGE_CLAUSE.lastIndex = 0
      out = out.replace(STORAGE_CLAUSE, formatStorageGb(storageGb, storageType))
    }
    STORAGE_CLAUSE.lastIndex = 0
  }
  if (ramGb > 0) {
    RAM_CLAUSE.lastIndex = 0
    if (RAM_CLAUSE.test(out)) {
      RAM_CLAUSE.lastIndex = 0
      out = out.replace(RAM_CLAUSE, `${ramGb}GB RAM`)
    }
    RAM_CLAUSE.lastIndex = 0
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

function applyQtySuffix(existing, unitName) {
  const prev = String(existing || '').trim()
  const qty = prev.match(/×\s*(\d+)\s*$/)
  return qty ? `${unitName} ×${qty[1]}` : unitName
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function loadState(key) {
  const { rows } = await pool.query('SELECT value FROM app_state WHERE key = $1', [key])
  return parseJson(rows[0]?.value, [])
}

async function saveState(client, key, value) {
  const now = new Date().toISOString()
  await client.query(
    `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), now],
  )
}

async function main() {
  const { rows: wos } = await pool.query(`
    SELECT wo.id, wo.ref, wo.serial_id, wo.product_id, wo.manufacturer_serial,
           wo.linked_sale_order_id, p.name AS product_name,
           snap.id AS snap_id, snap.display_name, snap.total_ram_gb,
           snap.primary_storage_gb, snap.storage_type
    FROM reconfiguration_work_orders wo
    JOIN products p ON p.id = wo.product_id
    LEFT JOIN device_configuration_snapshots snap ON snap.id = wo.proposed_snapshot_id
    WHERE wo.status = 'completed'
    ORDER BY wo.date_completed
  `)

  const serials = await loadState('deed_serials')
  const saleOrders = await loadState('deed_saleOrders')
  const invoices = await loadState('deed_invoices')
  const deliveries = await loadState('deed_deliveries')
  const report = []

  const client = await pool.connect()
  try {
    if (!DRY) await client.query('BEGIN')
    for (const wo of wos) {
      const ramGb = Number(wo.total_ram_gb) || 0
      const storageGb = Number(wo.primary_storage_gb) || 0
      const unitName = rewriteUnitCapacitiesInText(
        wo.product_name,
        ramGb,
        storageGb,
        wo.storage_type,
      )
      if (!unitName) continue
      const specsParts = []
      if (ramGb > 0) specsParts.push(`${ramGb}GB RAM`)
      if (storageGb > 0) specsParts.push(formatStorageGb(storageGb, wo.storage_type))
      const specs = specsParts.join(', ')
      const soRes = await client.query(
        `SELECT id, sale_order_id, description FROM sale_order_items WHERE serial_number_id = $1`,
        [wo.serial_id],
      )
      const soIds = [...new Set(soRes.rows.map(r => r.sale_order_id))]
      report.push({
        ref: wo.ref,
        serial: wo.manufacturer_serial,
        from: wo.display_name,
        to: unitName,
        saleOrders: soIds.length,
      })
      if (DRY) continue

      if (wo.snap_id && wo.display_name !== unitName) {
        await client.query(
          `UPDATE device_configuration_snapshots SET display_name = $2 WHERE id = $1`,
          [wo.snap_id, unitName],
        )
      }
      for (const item of soRes.rows) {
        await client.query(
          `UPDATE sale_order_items SET description = $2 WHERE id = $1`,
          [item.id, applyQtySuffix(item.description, unitName)],
        )
      }
      if (soIds.length) {
        await client.query(
          `UPDATE invoice_items ii
             SET description = CASE
               WHEN ii.description ~ '×\\s*[0-9]+\\s*$'
                 THEN $3 || regexp_replace(ii.description, '^.*(?=×\\s*[0-9]+\\s*$)', '')
               ELSE $3
             END,
                 serial_number_id = COALESCE(ii.serial_number_id, $1)
           FROM invoices i
           WHERE ii.invoice_id = i.id
             AND i.sale_order_id = ANY($2::uuid[])
             AND ii.product_id = $4`,
          [wo.serial_id, soIds, unitName, wo.product_id],
        )
      }
      await client.query(
        `UPDATE delivery_note_items
            SET description = $2,
                product_name = LEFT($2, 200),
                serial_number_id = COALESCE(serial_number_id, $1)
          WHERE serial_number_id = $1::uuid OR $1 = ANY(serial_ids)`,
        [wo.serial_id, unitName],
      )
      if (!wo.linked_sale_order_id && soIds.length === 1) {
        await client.query(
          `UPDATE reconfiguration_work_orders SET linked_sale_order_id = $2 WHERE id = $1`,
          [wo.id, soIds[0]],
        )
      }

      const sidx = serials.findIndex(s => s.id === wo.serial_id || s.serial === wo.manufacturer_serial)
      if (sidx >= 0) serials[sidx] = { ...serials[sidx], specs }
      else if (wo.manufacturer_serial) {
        serials.push({
          id: wo.serial_id,
          serial: wo.manufacturer_serial,
          barcode: wo.manufacturer_serial,
          productId: wo.product_id,
          productName: wo.product_name,
          specs,
          status: 'assigned',
          location: 'warehouse',
          receivedDate: new Date().toISOString().slice(0, 10),
        })
      }
      for (const so of saleOrders) {
        if (!Array.isArray(so?.lines)) continue
        so.lines = so.lines.map(line => {
          const ids = Array.isArray(line.serialIds) ? line.serialIds : []
          if (!ids.includes(wo.serial_id) && line.serialNumberId !== wo.serial_id) return line
          return {
            ...line,
            productName: unitName,
            description: applyQtySuffix(line.description || line.productName, unitName),
          }
        })
      }
      const soIdSet = new Set(soIds)
      for (const inv of invoices) {
        if (!Array.isArray(inv?.lines)) continue
        const onSo = inv.saleOrderId && soIdSet.has(inv.saleOrderId)
        inv.lines = inv.lines.map(line => {
          const ids = Array.isArray(line.serialIds) ? line.serialIds : []
          const matchesSerial = ids.includes(wo.serial_id) || line.serialNumberId === wo.serial_id
          const matchesHost = onSo && line.productId === wo.product_id
          if (!matchesSerial && !matchesHost) return line
          return {
            ...line,
            description: applyQtySuffix(line.description, unitName),
            ...(matchesSerial ? {} : { serialIds: [wo.serial_id] }),
          }
        })
      }
      for (const dn of deliveries) {
        if (!Array.isArray(dn?.lines)) continue
        dn.lines = dn.lines.map(line => {
          const ids = Array.isArray(line.serialIds) ? line.serialIds : []
          if (!ids.includes(wo.serial_id)) return line
          return { ...line, productName: unitName, description: unitName }
        })
      }
    }
    if (!DRY) {
      await saveState(client, 'deed_serials', serials)
      await saveState(client, 'deed_saleOrders', saleOrders)
      await saveState(client, 'deed_invoices', invoices)
      await saveState(client, 'deed_deliveries', deliveries)
      await client.query('COMMIT')
    }
  } catch (err) {
    if (!DRY) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
  console.log(JSON.stringify({ dryRun: DRY, repaired: report }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
