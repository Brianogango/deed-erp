#!/usr/bin/env node
/**
 * Ops helper: release orphan sale-order reservations that block Prepare Delivery.
 *
 * Quote→SO conversion can leave reservations with referenceId=SO and no deliveryId.
 * Older clients treat those as "elsewhere" and falsely report free stock short.
 *
 *   node scripts/release-orphan-reservations.mjs --request ops/release-orphan-reservations-request.json
 *   node scripts/release-orphan-reservations.mjs --mode list --order SO/2026/0014
 *   node scripts/release-orphan-reservations.mjs --mode release --order SO/2026/0014
 *   node scripts/release-orphan-reservations.mjs --mode release --order SO/2026/0014 --dry-run
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

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

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

const requestPath = String(arg('--request', '')).trim()
let cfg = {
  mode: String(arg('--mode', 'list')).trim().toLowerCase(),
  order: String(arg('--order', '')).trim(),
  customer: String(arg('--customer', '')).trim(),
  cancelOpenQuoteDeliveries: process.argv.includes('--cancel-open-quote-deliveries'),
  dryRun: process.argv.includes('--dry-run'),
}

if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  cfg = {
    mode: String(parsed.mode ?? cfg.mode).trim().toLowerCase(),
    order: String(parsed.order ?? cfg.order).trim(),
    customer: String(parsed.customer ?? cfg.customer).trim(),
    cancelOpenQuoteDeliveries: Boolean(parsed.cancelOpenQuoteDeliveries ?? cfg.cancelOpenQuoteDeliveries),
    dryRun: Boolean(parsed.dryRun ?? cfg.dryRun),
  }
}

if (!cfg.order && !cfg.customer) fail('Provide --order and/or --customer')

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  const [saleOrders, deliveries, reservations, products] = await Promise.all([
    loadJsonArray(client, 'deed_saleOrders'),
    loadJsonArray(client, 'deed_deliveries'),
    loadJsonArray(client, 'deed_stockReservations'),
    loadJsonArray(client, 'deed_products'),
  ])

  const orderNeedle = norm(cfg.order)
  const customerNeedle = norm(cfg.customer)
  const matchedOrders = saleOrders.filter(so => {
    const refHit = orderNeedle && (
      norm(so.ref) === orderNeedle
      || norm(so.orderNumber) === orderNeedle
      || norm(so.quotationRef) === orderNeedle
      || String(so.id) === cfg.order
    )
    const customerHit = customerNeedle && (
      norm(so.customerName).includes(customerNeedle)
      || norm(so.customerId) === customerNeedle
    )
    if (orderNeedle && customerNeedle) return refHit && customerHit
    if (orderNeedle) return refHit
    return customerHit
  })

  if (!matchedOrders.length) fail(`No sale orders matched order=${cfg.order || '-'} customer=${cfg.customer || '-'}`)

  const report = []
  let nextReservations = reservations.map(r => ({ ...r }))
  let nextDeliveries = deliveries.map(d => ({ ...d }))
  let cancelledReservations = 0
  let cancelledDeliveries = 0

  for (const so of matchedOrders) {
    const orphans = nextReservations.filter(r =>
      r.referenceId === so.id
      && r.status === 'reserved'
      && !r.deliveryId
    )
    const openDns = nextDeliveries.filter(d =>
      d.saleOrderId === so.id
      && !['done', 'cancelled'].includes(String(d.status || '').toLowerCase())
    )
    const entry = {
      id: so.id,
      ref: so.ref,
      status: so.status,
      locked: !!so.locked,
      customerName: so.customerName,
      orphanReservations: orphans.map(r => ({
        id: r.id,
        productId: r.productId,
        productName: r.productName || products.find(p => p.id === r.productId)?.name,
        qty: r.qty,
        location: r.location,
        referenceRef: r.referenceRef,
      })),
      openDeliveries: openDns.map(d => ({
        id: d.id,
        ref: d.ref,
        status: d.status,
        lines: (d.lines ?? []).map(l => ({ productName: l.productName, qty: l.qty, qtyDone: l.qtyDone })),
      })),
    }

    if (cfg.mode === 'release') {
      for (const orphan of orphans) {
        const idx = nextReservations.findIndex(r => r.id === orphan.id)
        if (idx < 0) continue
        nextReservations[idx] = {
          ...nextReservations[idx],
          status: 'cancelled',
          notes: `${nextReservations[idx].notes ?? ''} · ops: released orphan SO reservation (self-reservation blocked delivery)`.trim(),
        }
        cancelledReservations += 1
      }

      // Optional: cancel waiting DNs on other quotations for the same customer
      // so they cannot race the confirmed SO for the same stock.
      if (cfg.cancelOpenQuoteDeliveries) {
        const quoteIds = new Set(
          saleOrders
            .filter(q =>
              q.id !== so.id
              && norm(q.customerName) === norm(so.customerName)
              && String(q.status || '').toLowerCase() === 'quotation'
            )
            .map(q => q.id),
        )
        for (let i = 0; i < nextDeliveries.length; i++) {
          const d = nextDeliveries[i]
          if (!quoteIds.has(d.saleOrderId)) continue
          if (['done', 'cancelled'].includes(String(d.status || '').toLowerCase())) continue
          nextDeliveries[i] = {
            ...d,
            status: 'cancelled',
          }
          cancelledDeliveries += 1
          // Cancel reservations tied to those quote DNs
          nextReservations = nextReservations.map(r =>
            r.deliveryId === d.id && r.status === 'reserved'
              ? {
                  ...r,
                  status: 'cancelled',
                  notes: `${r.notes ?? ''} · ops: cancelled with open quote DN ${d.ref}`.trim(),
                }
              : r,
          )
        }
      }
    }

    report.push(entry)
  }

  console.log(JSON.stringify({
    mode: cfg.mode,
    dryRun: cfg.dryRun,
    matchedOrders: report,
    cancelledReservations: cfg.mode === 'release' ? cancelledReservations : 0,
    cancelledDeliveries: cfg.mode === 'release' ? cancelledDeliveries : 0,
  }, null, 2))

  if (cfg.mode === 'release' && !cfg.dryRun && (cancelledReservations > 0 || cancelledDeliveries > 0)) {
    await client.query('BEGIN')
    try {
      await saveJsonArray(client, 'deed_stockReservations', nextReservations)
      if (cancelledDeliveries > 0) {
        await saveJsonArray(client, 'deed_deliveries', nextDeliveries)
      }
      // Best-effort Prisma mirror (blob remains source of truth for the UI).
      try {
        for (const so of matchedOrders) {
          await client.query(
            `UPDATE stock_reservations
             SET status = 'cancelled', released_at = NOW()
             WHERE reference_id = $1
               AND status = 'reserved'`,
            [so.id],
          ).catch(() => null)
        }
      } catch {
        // Ignore mirror failures — app_state blob drives the client.
      }
      await client.query('COMMIT')
      console.log(`Saved: cancelled ${cancelledReservations} orphan reservation(s), ${cancelledDeliveries} quote DN(s)`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  } else if (cfg.mode === 'release' && cfg.dryRun) {
    console.log('Dry run — no changes written')
  } else if (cfg.mode === 'release') {
    console.log('Nothing to cancel')
  }
} finally {
  client.release()
  await pool.end()
}
