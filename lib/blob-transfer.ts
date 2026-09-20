import 'server-only'
import prisma from '@/lib/prisma'
import { sql } from '@/lib/auth/db'
import { isBlobKey } from '@/lib/blob-store'
import { writeStoreRecords, storeBackend } from '@/lib/prisma-store'

export type TransferDomainResult = {
  key: string
  storeRecords: number
  relational?: { upserted: number; skipped: number; error?: string }
}

export type TransferResult = {
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

async function transferSerials(rows: unknown[]): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0
  let skipped = 0
  for (const raw of rows) {
    const row = raw as Record<string, unknown>
    const serial = String(row.serial || row.serialNumber || '').trim()
    const productId = String(row.productId || '')
    if (!serial || !isUuid(productId)) { skipped += 1; continue }
    if (!(await productExists(productId))) { skipped += 1; continue }
    const status = SERIAL_STATUS[String(row.status || 'available')] || 'in_stock'
    const id = isUuid(row.id) ? String(row.id) : undefined
    try {
      const existing = await prisma.serialNumber.findFirst({
        where: { OR: id ? [{ id }, { serialNumber: serial }] : [{ serialNumber: serial }] },
        select: { id: true },
      })
      const data = {
        productId,
        serialNumber: serial.slice(0, 100),
        inventoryBarcode: row.barcode ? String(row.barcode).slice(0, 120) : null,
        status: status.slice(0, 30),
        notes: row.specs ? String(row.specs) : null,
      }
      if (existing) {
        await prisma.serialNumber.update({ where: { id: existing.id }, data })
      } else {
        await prisma.serialNumber.create({ data: { id: id || undefined, ...data } })
      }
      upserted += 1
    } catch {
      skipped += 1
    }
  }
  return { upserted, skipped }
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
    if (key === 'deed_deposits' || key === 'deed_deposits_v1') {
      const { mirrorDepositsToPrisma } = await import('@/lib/accounting/deposit-mirror')
      await mirrorDepositsToPrisma(value)
      return { upserted: rows.length, skipped: 0 }
    }
    if (key === 'deed_holdovers') {
      const { mirrorHoldoversToPrisma } = await import('@/lib/accounting/holdover-mirror')
      await mirrorHoldoversToPrisma(value)
      return { upserted: rows.length, skipped: 0 }
    }
    if (key === 'deed_deliveries') {
      const { mirrorDeliveryToPrisma } = await import('@/lib/delivery-mirror')
      let upserted = 0
      let skipped = 0
      for (const delivery of rows) {
        const result = await mirrorDeliveryToPrisma(delivery)
        if (result.mirrored) upserted += 1
        else skipped += 1
      }
      return { upserted, skipped }
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
