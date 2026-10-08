import 'server-only'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { sql } from '@/lib/auth/db'
import { isBlobKey } from '@/lib/blob-store'
import { writeStoreRecords, storeBackend } from '@/lib/prisma-store'

type TransferDomainResult = {
  key: string
  storeRecords: number
  relational?: { upserted: number; skipped: number; error?: string }
}

type TransferResult = {
  ok: boolean
  backend: ReturnType<typeof storeBackend>
  copied: number
  retired: number
  domains: TransferDomainResult[]
  errors: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function asArray(raw: string | null): unknown[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function readAllAppState(): Promise<Array<{ key: string; value: string }>> {
  const { rows } = await sql`SELECT key, value FROM app_state`
  return (rows as Array<{ key: string; value: string }>).filter(row => row.key && !isBlobKey(row.key))
}

async function fallbackUserId(): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return user?.id ?? null
}

const SERIAL_STATUS: Record<string, string> = {
  available: 'in_stock',
  assigned: 'reserved',
  sold: 'sold',
  under_repair: 'in_repair',
  returned: 'returned',
  written_off: 'written_off',
  refurbishment: 'refurbishment',
  reconfiguration: 'reconfiguration',
  capitalised: 'capitalised',
}

const MOVE_TYPE: Record<string, string> = {
  in: 'purchase_receive',
  out: 'sale',
  transfer: 'transfer',
  adjustment: 'adjustment_in',
  return: 'return_from_client',
}

async function productExists(id: string): Promise<boolean> {
  const row = await prisma.product.findUnique({ where: { id }, select: { id: true } })
  return Boolean(row)
}

/**
 * deed_serials fields read back from their own column; every other field
 * (the screen id, exact status and product name included) is kept in
 * screen_extras so the serial reads back as the screens saved it.
 */
export const SERIAL_COLUMN_FIELDS = ['serial', 'serialNumber', 'productId', 'barcode', 'location'] as const

function serialRow(row: Record<string, unknown>) {
  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v == null || (SERIAL_COLUMN_FIELDS as readonly string[]).includes(k)) continue
    extras[k] = v
  }
  return {
    productId: String(row.productId || ''),
    serialNumber: String(row.serial || row.serialNumber || '').trim().slice(0, 100),
    inventoryBarcode: row.barcode ? String(row.barcode).slice(0, 120) : null,
    status: (SERIAL_STATUS[String(row.status || 'available')] || 'in_stock').slice(0, 30),
    location: row.location ? String(row.location).slice(0, 40) : null,
    notes: row.specs ? String(row.specs) : null,
    screenExtras: Object.keys(extras).length ? extras as Prisma.InputJsonObject : Prisma.DbNull,
  }
}

/** JSON text with object keys sorted — the database stores jsonb keys in its own order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
const sameJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b)

/**
 * deed_serials → serial_numbers, location and screen details included.
 * Only serials that differ from their row are written: every serial save
 * used to rewrite all of them, two queries per serial.
 */
async function transferSerials(rows: unknown[]): Promise<{ upserted: number; skipped: number; error?: string }> {
  let upserted = 0
  let skipped = 0
  const errors: string[] = []
  const existing = await prisma.serialNumber.findMany({
    select: { id: true, serialNumber: true, productId: true, inventoryBarcode: true, status: true, location: true, notes: true, screenExtras: true, removedAt: true },
  })
  const bySerial = new Map(existing.map(s => [s.serialNumber, s]))
  const byId = new Map(existing.map(s => [s.id, s]))
  const products = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id))
  const listed = new Set<string>()
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const data = { ...serialRow(row), removedAt: null }
    if (data.serialNumber) listed.add(data.serialNumber)
    if (!data.serialNumber || !isUuid(data.productId) || !products.has(data.productId)) { skipped += 1; continue }
    const id = isUuid(row.id) ? String(row.id) : undefined
    const current = bySerial.get(data.serialNumber) ?? (id ? byId.get(id) : undefined)
    if (current
      && current.productId === data.productId
      && current.inventoryBarcode === data.inventoryBarcode
      && current.status === data.status
      && current.location === data.location
      && current.notes === data.notes
      && current.removedAt === null
      && sameJson(current.screenExtras, data.screenExtras === Prisma.DbNull ? null : data.screenExtras)) {
      continue
    }
    try {
      if (current) {
        await prisma.serialNumber.update({ where: { id: current.id }, data })
      } else {
        await prisma.serialNumber.create({ data: { id: id || undefined, ...data } })
      }
      upserted += 1
    } catch (err) {
      skipped += 1
      if (errors.length < 3) errors.push(err instanceof Error ? err.message.split('\n').filter(Boolean).slice(-1)[0] : String(err))
    }
  }
  // Serials gone from the list are marked removed, not deleted: invoices,
  // deliveries and repairs point at their row. A list much shorter than the
  // table is a partial save, not removals, and is left alone.
  const active = existing.filter(s => s.removedAt === null)
  const gone = active.filter(s => !listed.has(s.serialNumber))
  if (gone.length && listed.size >= active.length * 0.9) {
    await prisma.serialNumber.updateMany({ where: { id: { in: gone.map(s => s.id) } }, data: { removedAt: new Date() } })
  }
  return { upserted, skipped, ...(errors.length ? { error: errors.join(' | ') } : {}) }
}

/**
 * deed_bulkStock → stock_location_levels: the quantity per product and
 * location, rows the list no longer has removed. Only changed rows are
 * written. An empty list never empties the table.
 */
async function transferBulkStock(rows: unknown[]): Promise<{ upserted: number; skipped: number }> {
  const next = new Map<string, { productId: string; location: string; qty: number }>()
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const productId = String(row.productId || '').slice(0, 80)
    if (!productId) continue
    const location = String(row.location || 'warehouse').slice(0, 40)
    const key = `${productId}|${location}`
    const prev = next.get(key)
    next.set(key, { productId, location, qty: (prev?.qty ?? 0) + Math.round(Number(row.qty) || 0) })
  }
  const current = await prisma.stockLocationLevel.findMany()
  if (!next.size && current.length) return { upserted: 0, skipped: 0 }
  const have = new Map(current.map(r => [`${r.productId}|${r.location}`, r]))
  let upserted = 0
  for (const [key, row] of next) {
    if (have.get(key)?.qty === row.qty) continue
    await prisma.stockLocationLevel.upsert({
      where: { productId_location: { productId: row.productId, location: row.location } },
      create: row,
      update: { qty: row.qty },
    })
    upserted += 1
  }
  // A list much shorter than the table is a partial save: nothing is removed.
  const stale = next.size >= current.length * 0.5 ? current.filter(r => !next.has(`${r.productId}|${r.location}`)) : []
  for (const r of stale) {
    await prisma.stockLocationLevel.delete({ where: { productId_location: { productId: r.productId, location: r.location } } })
  }
  return { upserted: upserted + stale.length, skipped: 0 }
}

const validDate = (v: unknown) => {
  const d = v ? new Date(String(v)) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}

/**
 * deed_stockMoves → stock_movements. Each move is kept exactly as saved
 * (screen_extras); its product link is set when the products table has the
 * product. Only new or changed moves are written: the history only grows,
 * and every save used to upsert all of it.
 */
async function transferStockMoves(rows: unknown[], actorId: string | null): Promise<{ upserted: number; skipped: number; error?: string }> {
  let upserted = 0
  let skipped = 0
  const errors: string[] = []
  const existing = await prisma.stockMovement.findMany({
    where: { blobId: { not: null } },
    select: { blobId: true, screenExtras: true },
  })
  const have = new Map(existing.map(m => [String(m.blobId), m.screenExtras]))
  const products = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id))
  const actor = actorId && isUuid(actorId) ? actorId : null
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const blobId = String(row.id || '').slice(0, 80)
    if (!blobId) { skipped += 1; continue }
    if (have.has(blobId) && sameJson(have.get(blobId), row)) continue
    const productId = isUuid(row.productId) && products.has(String(row.productId)) ? String(row.productId) : null
    const qty = Math.max(0, Math.floor(Number(row.qty) || 0))
    const data = {
      productId,
      movementType: (MOVE_TYPE[String(row.type || 'adjustment')] || 'adjustment_in') as never,
      qty,
      qtyBefore: 0,
      qtyAfter: qty,
      notes: row.reason ? String(row.reason) : null,
      fromLocation: row.fromLocation ? String(row.fromLocation).slice(0, 40) : null,
      toLocation: row.toLocation ? String(row.toLocation).slice(0, 40) : null,
      documentRef: row.documentRef ? String(row.documentRef).slice(0, 80) : null,
      serialNumbers: Array.isArray(row.serialNumbers) ? row.serialNumbers.map(String) : [],
      screenExtras: row as Prisma.InputJsonObject,
    }
    try {
      await prisma.stockMovement.upsert({
        where: { blobId },
        create: { blobId, ...data, createdById: actor, createdAt: validDate(row.date) },
        update: data,
      })
      upserted += 1
    } catch (err) {
      skipped += 1
      if (errors.length < 3) errors.push(`${blobId}: ${err instanceof Error ? err.message.split('\n').filter(Boolean).slice(-1)[0] : String(err)}`)
    }
  }
  return { upserted, skipped, ...(errors.length ? { error: errors.join(' | ') } : {}) }
}

/**
 * deed_receipts → receipt_documents: each receipt (drafts included) kept as
 * saved. Only new or changed receipts are written; receipts gone from the
 * list are marked removed (unless the list is clearly partial).
 *
 * This used to write goods_received_notes, but only when a user id was
 * passed — saves never pass one, so nothing was ever written. Validating a
 * receipt writes goods_received_notes itself.
 */
async function transferReceipts(rows: unknown[]): Promise<{ upserted: number; skipped: number; error?: string }> {
  let upserted = 0
  let skipped = 0
  const errors: string[] = []
  const existing = await prisma.receiptDocument.findMany({ select: { id: true, record: true, removedAt: true } })
  const have = new Map(existing.map(r => [r.id, r]))
  const listed = new Set<string>()
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const id = String(row.id || '').slice(0, 80)
    if (!id) { skipped += 1; continue }
    listed.add(id)
    const current = have.get(id)
    if (current && current.removedAt === null && sameJson(current.record, row)) continue
    const data = {
      ref: row.ref ? String(row.ref).slice(0, 40) : null,
      poId: row.poId ? String(row.poId).slice(0, 80) : null,
      status: row.status ? String(row.status).slice(0, 20) : null,
      receiptDate: row.date ? String(row.date).slice(0, 40) : null,
      record: row as Prisma.InputJsonObject,
      removedAt: null,
    }
    try {
      await prisma.receiptDocument.upsert({ where: { id }, create: { id, ...data }, update: data })
      upserted += 1
    } catch (err) {
      skipped += 1
      if (errors.length < 3) errors.push(err instanceof Error ? err.message.split('\n').filter(Boolean).slice(-1)[0] : String(err))
    }
  }
  const active = existing.filter(r => r.removedAt === null)
  const gone = active.filter(r => !listed.has(r.id))
  if (gone.length && listed.size >= active.length * 0.9) {
    await prisma.receiptDocument.updateMany({ where: { id: { in: gone.map(r => r.id) } }, data: { removedAt: new Date() } })
  }
  return { upserted, skipped, ...(errors.length ? { error: errors.join(' | ') } : {}) }
}

/**
 * deed_products → products.screen_extras: each product as the screens saved
 * it (images, specs, units, stock count …). Catalog columns (name, prices,
 * active …) are written by the product routes and are not touched here.
 * Products the table does not have are counted as skipped.
 */
async function transferProducts(rows: unknown[]): Promise<{ upserted: number; skipped: number; error?: string }> {
  let upserted = 0
  let skipped = 0
  const errors: string[] = []
  const existing = await prisma.product.findMany({ select: { id: true, screenExtras: true } })
  const have = new Map(existing.map(p => [p.id, p.screenExtras]))
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const id = String(row.id || '')
    if (!have.has(id)) { skipped += 1; continue }
    if (sameJson(have.get(id), row)) continue
    try {
      await prisma.product.update({ where: { id }, data: { screenExtras: row as Prisma.InputJsonObject } })
      upserted += 1
    } catch (err) {
      skipped += 1
      if (errors.length < 3) errors.push(err instanceof Error ? err.message.split('\n').filter(Boolean).slice(-1)[0] : String(err))
    }
  }
  return { upserted, skipped, ...(errors.length ? { error: errors.join(' | ') } : {}) }
}

export async function mirrorKnownDomain(key: string, value: string, actorId: string | null): Promise<TransferDomainResult['relational']> {
  const rows = asArray(value)
  try {
    if (key === 'deed_repairs_v2') {
      const { mirrorRepairsToPrisma } = await import('@/lib/repair-mirror')
      const result = await mirrorRepairsToPrisma(rows, { force: true })
      return { upserted: result.mirrored, skipped: result.skipped }
    }
    if (key === 'deed_accounts') {
      const { mirrorAccountsToPrisma } = await import('@/lib/accounting/account-journal-mirror')
      await mirrorAccountsToPrisma(value)
      return { upserted: rows.length, skipped: 0 }
    }
    if (key === 'deed_journalEntries') {
      const { mirrorJournalEntriesToPrisma } = await import('@/lib/accounting/account-journal-mirror')
      await mirrorJournalEntriesToPrisma(value)
      return { upserted: rows.length, skipped: 0 }
    }
    if (key === 'deed_stockReservations') {
      const { mirrorStockReservationsToPrisma } = await import('@/lib/inventory/reservation-mirror')
      await mirrorStockReservationsToPrisma(value)
      return { upserted: rows.length, skipped: 0 }
    }
    if (key === 'deed_deliveries') {
      const { mirrorDeliveriesToPrisma } = await import('@/lib/delivery-mirror')
      await mirrorDeliveriesToPrisma(rows)
      return { upserted: rows.length, skipped: 0 }
    }
    if (key === 'deed_purchaseOrders') {
      const { ensurePrismaPurchaseOrder } = await import('@/lib/purchase/po-prisma-sync')
      let upserted = 0
      let skipped = 0
      for (const po of rows) {
        const id = String((po as { id?: string }).id || '')
        const resolved = await ensurePrismaPurchaseOrder(id, actorId)
        if (resolved) upserted += 1
        else skipped += 1
      }
      return { upserted, skipped }
    }
    if (key === 'deed_serials') return transferSerials(rows)
    if (key === 'deed_bulkStock') return transferBulkStock(rows)
    if (key === 'deed_stockMoves') return transferStockMoves(rows, actorId)
    if (key === 'deed_receipts') return transferReceipts(rows)
    if (key === 'deed_products') return transferProducts(rows)
  } catch (err) {
    return { upserted: 0, skipped: rows.length, error: err instanceof Error ? err.message : String(err) }
  }
  return undefined
}

/**
 * Copy every JSON app_state collection into Prisma `store_records`, then
 * upsert dedicated relational tables. Binary object-store keys are skipped.
 * Set retire=true only after a successful copy — live app_state rows are
 * archived then deleted.
 */
export async function transferBlobsToPrisma(opts?: { retire?: boolean }): Promise<TransferResult> {
  const errors: string[] = []
  const domains: TransferDomainResult[] = []
  const actorId = await fallbackUserId()
  const rows = await readAllAppState()
  const toCopy: Record<string, string> = {}
  for (const row of rows) {
    if (row.key.startsWith('archive:')) continue
    toCopy[row.key] = row.value
  }

  await writeStoreRecords(toCopy)

  for (const [key, value] of Object.entries(toCopy)) {
    const relational = await mirrorKnownDomain(key, value, actorId)
    domains.push({
      key,
      storeRecords: 1,
      relational,
    })
  }

  let retired = 0
  if (opts?.retire) {
    const keys = Object.keys(toCopy)
    for (const key of keys) {
      const archiveKey = `archive:${key}:prisma-transfer`
      try {
        await sql`
          INSERT INTO app_state (key, value, updated_at)
          VALUES (${archiveKey}, ${toCopy[key]}, ${new Date().toISOString()})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        `
        const stored = await prisma.storeRecord.findUnique({ where: { key }, select: { key: true } })
        if (!stored) {
          errors.push(`Refuse to retire ${key}: missing store_records copy`)
          continue
        }
        await sql`DELETE FROM app_state WHERE key = ${key}`
        retired += 1
      } catch (err) {
        errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    backend: storeBackend(),
    copied: Object.keys(toCopy).length,
    retired,
    domains,
    errors,
  }
}

export async function countLiveAppStateKeys(): Promise<number> {
  const { rows } = await sql`
    SELECT COUNT(*)::int AS n FROM app_state WHERE key NOT LIKE ${'archive:%'}
  `
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0)
}
