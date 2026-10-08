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
async function transferSerials(rows: unknown[]): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0
  let skipped = 0
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
    } catch {
      skipped += 1
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
  return { upserted, skipped }
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
  const stale = current.filter(r => !next.has(`${r.productId}|${r.location}`))
  for (const r of stale) {
    await prisma.stockLocationLevel.delete({ where: { productId_location: { productId: r.productId, location: r.location } } })
  }
  return { upserted: upserted + stale.length, skipped: 0 }
}

async function transferStockMoves(rows: unknown[], actorId: string | null): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0
  let skipped = 0
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const blobId = String(row.id || '').slice(0, 80)
    const productId = String(row.productId || '')
    if (!blobId || !isUuid(productId)) { skipped += 1; continue }
    if (!(await productExists(productId))) { skipped += 1; continue }
    const qty = Math.max(0, Math.floor(Number(row.qty) || 0))
    const movementType = MOVE_TYPE[String(row.type || 'adjustment')] || 'adjustment_in'
    try {
      await prisma.stockMovement.upsert({
        where: { blobId },
        create: {
          blobId,
          productId,
          movementType: movementType as never,
          qty,
          qtyBefore: 0,
          qtyAfter: qty,
          notes: row.reason ? String(row.reason) : null,
          fromLocation: row.fromLocation ? String(row.fromLocation).slice(0, 40) : null,
          toLocation: row.toLocation ? String(row.toLocation).slice(0, 40) : null,
          documentRef: row.documentRef ? String(row.documentRef).slice(0, 80) : null,
          serialNumbers: Array.isArray(row.serialNumbers) ? row.serialNumbers.map(String) : [],
          createdById: actorId && isUuid(actorId) ? actorId : null,
          createdAt: row.date ? new Date(String(row.date)) : new Date(),
        },
        update: {
          productId,
          qty,
          notes: row.reason ? String(row.reason) : null,
          documentRef: row.documentRef ? String(row.documentRef).slice(0, 80) : null,
        },
      })
      upserted += 1
    } catch {
      skipped += 1
    }
  }
  return { upserted, skipped }
}

async function transferReceipts(rows: unknown[], actorId: string | null): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0
  let skipped = 0
  if (!actorId) return { upserted, skipped: rows.length }
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const id = String(row.id || '')
    const poId = String(row.poId || '')
    const grnNumber = String(row.ref || id).slice(0, 30)
    if (!isUuid(id) || !isUuid(poId) || !grnNumber) { skipped += 1; continue }
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } })
    if (!po) { skipped += 1; continue }
    try {
      await prisma.goodsReceivedNote.upsert({
        where: { id },
        create: {
          id,
          grnNumber,
          poId,
          receivedDate: row.date ? new Date(String(row.date)) : new Date(),
          notes: row.vendorName ? String(row.vendorName) : null,
          createdById: actorId,
        },
        update: {
          notes: row.vendorName ? String(row.vendorName) : null,
        },
      })
      upserted += 1
    } catch {
      skipped += 1
    }
  }
  return { upserted, skipped }
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
    if (key === 'deed_receipts') return transferReceipts(rows, actorId)
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
