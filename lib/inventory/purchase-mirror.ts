import 'server-only'
import { createHash } from 'crypto'
import type { PurchaseOrderStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const PO_HASH_KEY = 'purchase_order_mirror_hashes_v1'
const GRN_HASH_KEY = 'receipt_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

function asUuid(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}

function asDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function mapPoStatus(raw: unknown): PurchaseOrderStatus {
  const s = String(raw ?? 'draft').toLowerCase()
  if (s === 'draft') return 'draft'
  if (s === 'sent' || s === 'pending_approval') return 'pending_approval'
  if (s === 'confirmed' || s === 'approved') return 'approved'
  if (s === 'partial' || s === 'partially_received') return 'partially_received'
  if (s === 'received') return 'received'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'draft'
}

async function ensureFallbackUserId(): Promise<string | null> {
  const u = await prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return u?.id ?? null
}

/** Ensure a suppliers row exists for a blob vendor (contact) id. */
async function ensureSupplier(vendorId: string, vendorName: string): Promise<string | null> {
  const id = asUuid(vendorId)
  if (!id) return null
  const existing = await prisma.supplier.findUnique({ where: { id }, select: { id: true } })
  if (existing) return existing.id
  const name = (vendorName || 'Vendor').slice(0, 200)
  const supplierNumber = `V-${id.replace(/-/g, '').slice(0, 12)}`.slice(0, 20)
  try {
    await prisma.supplier.create({
      data: {
        id,
        supplierNumber,
        name,
        isActive: true,
      },
    })
    return id
  } catch {
    // Race / unique on supplier_number — try find again.
    const again = await prisma.supplier.findUnique({ where: { id }, select: { id: true } })
    if (again) return again.id
    const byNum = await prisma.supplier.findFirst({
      where: { supplierNumber },
      select: { id: true },
    })
    return byNum?.id ?? null
  }
}

let _poRunning = false
let _grnRunning = false

/**
 * Dual-write `deed_purchaseOrders` → `purchase_orders` + `purchase_order_items`.
 * Creates stub `suppliers` rows for blob vendorIds when missing.
 */
export async function mirrorPurchaseOrdersToPrisma(input: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_poRunning) return result
  _poRunning = true
  try {
    const rows: any[] = typeof input === 'string' ? JSON.parse(input) : (input as any[])
    if (!Array.isArray(rows) || rows.length === 0) return result

    const state = await loadAppState([PO_HASH_KEY])
    const hashes: Record<string, string> =
      !opts.force && state[PO_HASH_KEY] && typeof state[PO_HASH_KEY] === 'object'
        ? (state[PO_HASH_KEY] as Record<string, string>)
        : {}
    const nextHashes = { ...hashes }
    let dirty = false

    const productIds = new Set(
      (await prisma.product.findMany({ select: { id: true } })).map(p => p.id),
    )
    const fallbackUserId = await ensureFallbackUserId()
    if (!fallbackUserId) return result

    for (const r of rows) {
      const blobId = String(r?.id ?? '').trim()
      if (!blobId) continue
      try {
        const supplierId = await ensureSupplier(
          String(r.vendorId ?? ''),
          String(r.vendorName ?? 'Vendor'),
        )
        if (!supplierId) {
          result.failed++
          continue
        }

        const lines = Array.isArray(r.lines) ? r.lines : []
        const linePayload = lines
          .map((line: any, idx: number) => {
            const productId =
              asUuid(line.productId) && productIds.has(String(line.productId))
                ? String(line.productId)
                : null
            if (!productId) return null
            const lineId =
              asUuid(line.id) ?? uuidFromKey('po-item', `${blobId}:${idx}:${productId}`)
            const qty = Math.max(0, Number(line.qty) || 0)
            const unitCost = Number(line.unitPrice ?? line.unitCost ?? 0) || 0
            const taxRate = Number(line.taxRate ?? 0) || 0
            const lineTotal = Number(line.subtotal ?? qty * unitCost) || 0
            return {
              id: lineId,
              productId,
              description: line.productName ? String(line.productName) : null,
              qtyOrdered: qty,
              qtyReceived: Math.max(0, Number(line.qtyReceived) || 0),
              unitCost,
              taxRate,
              lineTotal,
              notes: line.accountCode ? `account:${line.accountCode}` : null,
            }
          })
          .filter(Boolean) as Array<{
          id: string
          productId: string
          description: string | null
          qtyOrdered: number
          qtyReceived: number
          unitCost: number
          taxRate: number
          lineTotal: number
          notes: string | null
        }>

        const header = {
          blobId,
          poNumber: String(r.ref || blobId).slice(0, 30),
          supplierId,
          vendorName: r.vendorName ? String(r.vendorName).slice(0, 200) : null,
          status: mapPoStatus(r.status),
          orderDate: asDate(r.date) ?? new Date(),
          expectedDate: asDate(r.expectedDate),
          subtotal: Number(r.subtotal) || 0,
          taxAmount: Number(r.taxTotal ?? r.taxAmount) || 0,
          totalAmount: Number(r.total ?? r.totalAmount) || 0,
          notes: r.notes ? String(r.notes) : null,
          lockVersion: Number(r.lockVersion) || 0,
          createdById: fallbackUserId,
        }
        const fp = fingerprint({ header, lines: linePayload })
        if (!opts.force && hashes[blobId] === fp) {
          result.skipped++
          continue
        }

        const id = asUuid(blobId) ?? uuidFromKey('po', blobId)
        await prisma.$transaction(async tx => {
          const existing = await tx.purchaseOrder.findFirst({
            where: { OR: [{ blobId }, { id }, { poNumber: header.poNumber }] },
            select: { id: true },
          })
          const poId = existing?.id ?? id
          if (existing) {
            await tx.purchaseOrder.update({ where: { id: poId }, data: header })
            // Upsert lines — never delete (GRN items FK purchase_order_items).
            for (const line of linePayload) {
              await tx.purchaseOrderItem.upsert({
                where: { id: line.id },
                create: { ...line, poId },
                update: {
                  description: line.description,
                  qtyOrdered: line.qtyOrdered,
                  qtyReceived: line.qtyReceived,
                  unitCost: line.unitCost,
                  taxRate: line.taxRate,
                  lineTotal: line.lineTotal,
                  notes: line.notes,
                },
              })
            }
          } else {
            await tx.purchaseOrder.create({
              data: {
                id: poId,
                ...header,
                items: linePayload.length
                  ? { create: linePayload.map(line => ({ ...line })) }
                  : undefined,
              },
            })
          }
        })

        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        console.error('[purchase-mirror] PO failed', blobId, err)
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [PO_HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[purchase-mirror] failed', err)
    return result
  } finally {
    _poRunning = false
  }
}

/**
 * Dual-write `deed_receipts` → `goods_received_notes` + `grn_items`.
 * Requires PO (+ items) already mirrored; skips receipts whose PO is missing.
 */
export async function mirrorReceiptsToPrisma(input: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_grnRunning) return result
  _grnRunning = true
  try {
    const rows: any[] = typeof input === 'string' ? JSON.parse(input) : (input as any[])
    if (!Array.isArray(rows) || rows.length === 0) return result

    const state = await loadAppState([GRN_HASH_KEY])
    const hashes: Record<string, string> =
      !opts.force && state[GRN_HASH_KEY] && typeof state[GRN_HASH_KEY] === 'object'
        ? (state[GRN_HASH_KEY] as Record<string, string>)
        : {}
    const nextHashes = { ...hashes }
    let dirty = false

    const productIds = new Set(
      (await prisma.product.findMany({ select: { id: true } })).map(p => p.id),
    )
    const fallbackUserId = await ensureFallbackUserId()
    if (!fallbackUserId) return result

    const pos = await prisma.purchaseOrder.findMany({
      select: { id: true, blobId: true, items: { select: { id: true, productId: true } } },
    })
    const poById = new Map(pos.map(p => [p.id, p]))
    const poByBlob = new Map(pos.filter(p => p.blobId).map(p => [p.blobId!, p]))

    for (const r of rows) {
      const blobId = String(r?.id ?? '').trim()
      if (!blobId) continue
      try {
        const poBlobId = String(r.poId ?? '').trim()
        const po =
          (asUuid(poBlobId) && poById.get(poBlobId)) ||
          poByBlob.get(poBlobId) ||
          null
        if (!po) {
          result.failed++
          continue
        }

        const lines = Array.isArray(r.lines) ? r.lines : []
        const linePayload = lines
          .map((line: any, idx: number) => {
            const productId =
              asUuid(line.productId) && productIds.has(String(line.productId))
                ? String(line.productId)
                : null
            if (!productId) return null
            const poItem =
              po.items.find(i => i.productId === productId) ??
              null
            const poItemId = poItem?.id ?? uuidFromKey('po-item', `${po.id}:${productId}`)
            return {
              id: uuidFromKey('grn-item', `${blobId}:${idx}`),
              poItemId,
              productId,
              productName: line.productName ? String(line.productName).slice(0, 200) : null,
              qtyExpected: Math.max(0, Number(line.qtyExpected) || 0),
              qtyReceived: Math.max(0, Number(line.qtyReceived) || 0),
              unitCost: 0,
              serialNumbers: Array.isArray(line.serials)
                ? line.serials.map((s: unknown) => String(s)).filter(Boolean)
                : [],
            }
          })
          .filter(Boolean) as Array<{
          id: string
          poItemId: string
          productId: string
          productName: string | null
          qtyExpected: number
          qtyReceived: number
          unitCost: number
          serialNumbers: string[]
        }>

        // Ensure any missing PO items exist (receipt line without matching PO line).
        for (const line of linePayload) {
          if (!po.items.some(i => i.id === line.poItemId)) {
            try {
              await prisma.purchaseOrderItem.create({
                data: {
                  id: line.poItemId,
                  poId: po.id,
                  productId: line.productId,
                  description: line.productName,
                  qtyOrdered: line.qtyExpected || line.qtyReceived || 1,
                  qtyReceived: line.qtyReceived,
                  unitCost: 0,
                  taxRate: 0,
                  lineTotal: 0,
                },
              })
              po.items.push({ id: line.poItemId, productId: line.productId })
            } catch {
              /* already exists */
            }
          }
        }

        const header = {
          blobId,
          grnNumber: String(r.ref || blobId).slice(0, 30),
          poId: po.id,
          receivedDate: asDate(r.date) ?? new Date(),
          destinationLocation: String(r.destinationLocation ?? 'warehouse').slice(0, 40),
          status: String(r.status ?? 'draft').slice(0, 20),
          vendorName: r.vendorName ? String(r.vendorName).slice(0, 200) : null,
          createdById: fallbackUserId,
        }
        const fp = fingerprint({ header, lines: linePayload })
        if (!opts.force && hashes[blobId] === fp) {
          result.skipped++
          continue
        }

        const id = asUuid(blobId) ?? uuidFromKey('grn', blobId)
        await prisma.$transaction(async tx => {
          const existing = await tx.goodsReceivedNote.findFirst({
            where: { OR: [{ blobId }, { id }, { grnNumber: header.grnNumber }] },
            select: { id: true },
          })
          const grnId = existing?.id ?? id
          if (existing) {
            await tx.goodsReceivedNote.update({ where: { id: grnId }, data: header })
            await tx.grnItem.deleteMany({ where: { grnId } })
          } else {
            await tx.goodsReceivedNote.create({ data: { id: grnId, ...header } })
          }
          if (linePayload.length) {
            await tx.grnItem.createMany({
              data: linePayload.map(line => ({ ...line, grnId })),
            })
          }
        })

        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        console.error('[purchase-mirror] GRN failed', blobId, err)
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [GRN_HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[purchase-mirror] GRN failed', err)
    return result
  } finally {
    _grnRunning = false
  }
}
