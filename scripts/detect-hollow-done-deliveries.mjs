#!/usr/bin/env node
/**
 * Ops detector: list Done deliveries with effective delivered qty = 0.
 *
 *   node scripts/detect-hollow-done-deliveries.mjs
 *   node scripts/detect-hollow-done-deliveries.mjs --json
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

function effectiveQty(line) {
  const demand = Math.max(0, Number(line?.qty) || 0)
  const fromDone = Math.max(0, Number(line?.qtyDone) || 0)
  const fromSerials = Array.isArray(line?.serialIds) ? line.serialIds.length : 0
  const raw = Math.max(fromDone, fromSerials)
  return demand > 0 ? Math.min(raw, demand) : raw
}

function deliveredTotal(delivery) {
  return (delivery?.lines ?? []).reduce((sum, line) => sum + effectiveQty(line), 0)
}

const asJson = process.argv.includes('--json')
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function main() {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(`SELECT value FROM app_state WHERE key = 'deed_deliveries'`)
    const deliveries = rows.length ? JSON.parse(rows[0].value) : []
    const list = (Array.isArray(deliveries) ? deliveries : [])
      .filter(d => String(d?.status ?? '') === 'done' && deliveredTotal(d) <= 0)
      .map(d => ({
        ref: d.ref,
        saleOrderRef: d.saleOrderRef ?? null,
        saleOrderId: d.saleOrderId ?? null,
        deliveryNoteGeneratedAt: d.deliveryNoteGeneratedAt ?? null,
        preparedAt: d.preparedAt ?? null,
        lines: (d.lines ?? []).map(l => ({
          productName: l.productName ?? l.productId,
          qty: l.qty,
          qtyDone: l.qtyDone ?? 0,
          serialCount: Array.isArray(l.serialIds) ? l.serialIds.length : 0,
        })),
      }))

    if (asJson) {
      console.log(JSON.stringify({ count: list.length, items: list }, null, 2))
    } else if (list.length === 0) {
      console.log('OK: no hollow Done deliveries')
    } else {
      console.log(`FOUND ${list.length} hollow Done delivery(ies):`)
      for (const item of list) {
        console.log(
          `  - ${item.ref} SO=${item.saleOrderRef ?? item.saleOrderId}` +
            ` generated=${Boolean(item.deliveryNoteGeneratedAt)}` +
            ` lines=${item.lines.length}`,
        )
      }
      process.exitCode = 2
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
