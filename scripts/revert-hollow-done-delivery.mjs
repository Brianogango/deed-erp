#!/usr/bin/env node
/**
 * Ops helper: safely revert a hollow Done delivery (Delivered=0, no serials)
 * back to Ready/Waiting so Generate DN / Invoice unlock is removed.
 *
 * NEVER invents qtyDelivered. NEVER deletes sale orders, invoices, or serials.
 *
 *   node scripts/revert-hollow-done-delivery.mjs --order SO/2026/0008 --delivery DN/2026/0009
 *   node scripts/revert-hollow-done-delivery.mjs --order SO/2026/0008 --delivery DN/2026/0009 --dry-run
 *   node scripts/revert-hollow-done-delivery.mjs --all-hollow --dry-run
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

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

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

function isHollowDone(delivery) {
  return String(delivery?.status ?? '') === 'done' && deliveredTotal(delivery) <= 0
}

const orderRef = String(arg('--order', '')).trim()
const deliveryRef = String(arg('--delivery', '')).trim()
const allHollow = process.argv.includes('--all-hollow')
const dryRun = process.argv.includes('--dry-run')

if (!allHollow && (!orderRef || !deliveryRef)) {
  fail('Pass --order SO/… --delivery DN/…  OR  --all-hollow')
}

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
    const deliveries = await loadJsonArray(client, 'deed_deliveries')
    const targets = []

    if (allHollow) {
      for (const d of deliveries) {
        if (isHollowDone(d)) targets.push(d)
      }
    } else {
      const match = deliveries.find(d =>
        d?.ref === deliveryRef &&
        (d?.saleOrderRef === orderRef || !orderRef),
      )
      if (!match) fail(`Delivery ${deliveryRef} not found`)
      if (match.saleOrderRef && orderRef && match.saleOrderRef !== orderRef) {
        fail(`Delivery ${deliveryRef} belongs to ${match.saleOrderRef}, not ${orderRef}`)
      }
      console.log(`Found ${match.ref} status=${match.status} SO=${match.saleOrderRef}`)
      console.log(`  lines=${(match.lines ?? []).length} deliveredTotal=${deliveredTotal(match)}`)
      for (const line of match.lines ?? []) {
        console.log(
          `  - ${line.productName ?? line.productId}: qty=${line.qty} qtyDone=${line.qtyDone ?? 0}` +
            ` serials=${(line.serialIds ?? []).length}`,
        )
      }
      if (!isHollowDone(match)) {
        fail(`${deliveryRef} is not a hollow Done delivery (delivered=${deliveredTotal(match)}). Refusing to change.`)
      }
      targets.push(match)
    }

    if (targets.length === 0) {
      console.log('No hollow Done deliveries found')
      return
    }

    let changed = 0
    for (const del of targets) {
      const nextStatus = del.preparedAt ? 'ready' : 'waiting'
      console.log(
        `Revert ${del.ref} (${del.saleOrderRef ?? del.saleOrderId}): done → ${nextStatus}` +
          `; clear deliveryNoteGeneratedAt=${Boolean(del.deliveryNoteGeneratedAt)}`,
      )
      if (!dryRun) {
        del.status = nextStatus
        delete del.deliveryNoteGeneratedAt
        delete del.deliveryNoteGeneratedByUserId
        // Keep lines, recipient, serials, qtyDone as-is — no data invented, nothing deleted.
        changed += 1
      }
    }

    if (dryRun) {
      console.log(`[dry-run] Would revert ${targets.length} hollow Done delivery(ies)`)
      return
    }

    await saveJsonArray(client, 'deed_deliveries', deliveries)
    console.log(`OK: reverted ${changed} hollow Done delivery(ies). SO qty_delivered untouched.`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
