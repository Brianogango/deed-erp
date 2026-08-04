#!/usr/bin/env node
/**
 * Ops helper: inspect a sale order / customer for delivery + reservation issues.
 *
 *   node scripts/find-sale-orders.mjs --q "Moses Gitonga"
 *   node scripts/find-sale-orders.mjs --request ops/find-sale-orders-request.json
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

function allArgs(flag) {
  const out = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1])
  }
  return out
}

function fail(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

const connectionString =
  process.env.deed_erp_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) fail('DATABASE_URL / POSTGRES_URL is not set')

const requestPath = String(arg('--request', '')).trim()
let queries = allArgs('--q').map(s => String(s).trim()).filter(Boolean)
if (requestPath) {
  const abs = resolve(ROOT, requestPath)
  if (!existsSync(abs)) fail(`Request file not found: ${abs}`)
  const parsed = JSON.parse(readFileSync(abs, 'utf8'))
  const fromFile = Array.isArray(parsed?.queries) ? parsed.queries : []
  queries = [...queries, ...fromFile.map(s => String(s).trim()).filter(Boolean)]
  if (parsed?.customer) queries.push(String(parsed.customer))
  if (parsed?.order) queries.push(String(parsed.order))
}
queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]
if (!queries.length) fail('Provide --q / queries[] / customer / order')

const needles = queries.map(norm)
const pool = new Pool({ connectionString })

async function loadJson(key) {
  const { rows } = await pool.query(`SELECT value FROM app_state WHERE key = $1`, [key])
  if (!rows.length) return []
  const raw = rows[0].value
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Array.isArray(parsed) ? parsed : []
}

function matches(hay) {
  const text = norm(hay)
  return needles.some(n => text.includes(n))
}

try {
  const [saleOrders, deliveries, reservations, serials, products, bulkStock, approvals] = await Promise.all([
    loadJson('deed_saleOrders'),
    loadJson('deed_deliveries'),
    loadJson('deed_stockReservations'),
    loadJson('deed_serials'),
    loadJson('deed_products'),
    loadJson('deed_bulkStock'),
    loadJson('deed_approvalRequests'),
  ])

  console.log(`Queries: ${queries.join(', ')}`)
  console.log(`Totals — SOs:${saleOrders.length} DNs:${deliveries.length} reservations:${reservations.length}`)

  const sos = saleOrders.filter(so =>
    matches(so.ref) ||
    matches(so.customerName) ||
    matches(so.customerId) ||
    matches(so.notes) ||
    (so.lines || []).some(l => matches(l.productName)),
  ).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

  console.log(`Matched SOs: ${sos.length}`)

  for (const so of sos.slice(0, 10)) {
    const dns = deliveries.filter(d => d.saleOrderId === so.id || d.saleOrderRef === so.ref)
    const soReservations = reservations.filter(r =>
      r.referenceId === so.id ||
      r.referenceRef === so.ref ||
      dns.some(d => d.id === r.deliveryId || d.ref === r.referenceRef),
    )
    const soApprovals = approvals.filter(a =>
      a.documentId === so.id || a.documentRef === so.ref || a.referenceId === so.id,
    )
    const soSerials = serials.filter(s => s.saleOrderId === so.id || s.saleOrderRef === so.ref)

    const lineDiag = (so.lines || []).map(line => {
      const product = products.find(p => p.id === line.productId)
      const reservedForThis = soReservations
        .filter(r => r.productId === line.productId && r.status === 'reserved')
        .reduce((s, r) => s + (Number(r.qty) || 0), 0)
      const reservedElsewhere = reservations
        .filter(r =>
          r.productId === line.productId &&
          r.status === 'reserved' &&
          r.referenceId !== so.id &&
          !dns.some(d => d.id === r.deliveryId),
        )
        .reduce((s, r) => s + (Number(r.qty) || 0), 0)
      const availableSerials = serials.filter(s =>
        s.productId === line.productId &&
        (s.status === 'available' || s.status === 'in_stock') &&
        ['warehouse', 'shop', 'repair_unit'].includes(s.location),
      ).length
      const assignedSerials = serials.filter(s =>
        s.productId === line.productId &&
        s.status === 'assigned' &&
        s.saleOrderId === so.id,
      )
      const bulk = bulkStock.filter(b => b.productId === line.productId)
      const bulkByLoc = bulk.reduce((acc, b) => {
        acc[b.location] = (acc[b.location] || 0) + (Number(b.qty) || 0)
        return acc
      }, {})
      return {
        productId: line.productId,
        productName: line.productName,
        qty: line.qty,
        qtyDelivered: line.qtyDelivered ?? 0,
        requiresSerial: !!product?.requiresSerial,
        stockQty: product?.stockQty ?? null,
        availableSerials,
        assignedSerials: assignedSerials.map(s => ({ id: s.id, serial: s.serial, location: s.location, status: s.status })),
        lineSerialIds: line.serialIds || [],
        reservedForThisOrder: reservedForThis,
        reservedElsewhere,
        bulkByLoc,
      }
    })

    console.log('\n==== SALE ORDER ====')
    console.log(JSON.stringify({
      id: so.id,
      ref: so.ref,
      status: so.status,
      customerName: so.customerName,
      customerId: so.customerId,
      date: so.date,
      total: so.total,
      approvalStatus: so.approvalStatus,
      backorderApprovalId: so.backorderApprovalId,
      backorderLines: so.backorderLines,
      stockReservationIds: so.stockReservationIds,
      deliveryIds: so.deliveryIds,
      locked: so.locked,
      notes: so.notes,
    }, null, 2))

    console.log('---- lines / stock ----')
    console.log(JSON.stringify(lineDiag, null, 2))

    console.log('---- deliveries ----')
    console.log(JSON.stringify(dns.map(d => ({
      id: d.id,
      ref: d.ref,
      status: d.status,
      backorderOfRef: d.backorderOfRef,
      lines: (d.lines || []).map(l => ({
        productId: l.productId,
        productName: l.productName,
        qty: l.qty,
        qtyDone: l.qtyDone,
        serialIds: l.serialIds,
        sourceLocation: l.sourceLocation,
      })),
    })), null, 2))

    console.log('---- reservations ----')
    console.log(JSON.stringify(soReservations.map(r => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      qty: r.qty,
      status: r.status,
      referenceId: r.referenceId,
      referenceRef: r.referenceRef,
      referenceType: r.referenceType,
      deliveryId: r.deliveryId,
      location: r.location,
      reservedDate: r.reservedDate,
      fulfilledQty: r.fulfilledQty,
      notes: r.notes,
    })), null, 2))

    console.log('---- approvals ----')
    console.log(JSON.stringify(soApprovals.map(a => ({
      id: a.id,
      type: a.type,
      status: a.status,
      documentRef: a.documentRef,
      details: a.details,
      notes: a.notes,
    })), null, 2))

    console.log('---- assigned serials ----')
    console.log(JSON.stringify(soSerials.map(s => ({
      id: s.id,
      serial: s.serial,
      productId: s.productId,
      status: s.status,
      location: s.location,
      saleOrderId: s.saleOrderId,
    })), null, 2))
  }

  if (!sos.length) {
    // Fallback: show recent reservations mentioning the query in notes/refs
    const relatedRes = reservations.filter(r =>
      matches(r.referenceRef) || matches(r.productName) || matches(r.notes),
    ).slice(0, 20)
    console.log('No SO match. Related reservations sample:')
    console.log(JSON.stringify(relatedRes, null, 2))
  }
} finally {
  await pool.end()
}
