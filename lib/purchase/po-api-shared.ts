import 'server-only'
import prisma from '@/lib/prisma'
import { resolveClientId, optionalUuid } from '@/lib/legacy-compat'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'
import { resolveVendorBillPoItem } from '@/lib/purchase/bill-po-line-match'

/**
 * Shared helpers for the purchase-order API routes. Next.js route files may
 * only export HTTP handlers + config, so these live here — never in a
 * route.ts (the route type check fails the production build otherwise).
 */
export const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

const PASSTHROUGH_KEYS = [
  'receiptIds', 'billId', 'approvalStatus', 'approvalRequestIds',
  'repairId', 'repairRef', 'procurementRequestId',
] as const

export function mapPOLineToClient(item: any) {
  const requiresSerial = item.product ? isSerialTracking(inferTrackingMethod(item.product)) : false
  return {
    id: item.id,
    productId: item.productId ?? '',
    productName: item.description ?? item.product?.name ?? '',
    qty: item.qtyOrdered,
    qtyReceived: item.qtyReceived,
    qtyBilled: item.qtyBilled,
    unitPrice: Number(item.unitCost),
    taxRate: Number(item.taxRate),
    subtotal: Number(item.lineTotal),
    requiresSerial,
    ...(item.accountCode ? { accountCode: item.accountCode } : {}),
  }
}

export function mapPOToClient(po: any) {
  return {
    id: po.id,
    ref: po.poNumber,
    status: po.status,
    vendorId: po.clientId ?? '',
    vendorName: po.vendor?.name ?? '',
    date: po.orderDate ? new Date(po.orderDate).toISOString().slice(0, 10) : '',
    expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString().slice(0, 10) : '',
    lines: (po.items ?? []).map(mapPOLineToClient),
    subtotal: Number(po.subtotal ?? 0),
    taxTotal: Number(po.taxAmount ?? 0),
    total: Number(po.totalAmount ?? 0),
    notes: po.notes ?? '',
    lockVersion: Number(po.lockVersion ?? 0),
  }
}

const safeMoney = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(9_999_999_999.99, Math.max(0, n))
}

const safeQty = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1_000_000, Math.max(0, Math.floor(n)))
}

const safeTaxRate = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

const safeShortText = (value: unknown, max = 1_000) => {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text.slice(0, max) : null
}

export function mapPOItemsForCreate(lines: any[]) {
  return lines
    .filter((l: any) => Boolean(optionalUuid(l.productId)))
    .map((l: any) => {
      const qtyOrdered = safeQty(l.qty)
      const unitCost = safeMoney(l.unitPrice)
      const taxRate = safeTaxRate(l.taxRate)
      return {
        productId: optionalUuid(l.productId),
        description: safeShortText(l.productName ?? l.description),
        qtyOrdered,
        // Receipt/billing progress is server-owned and can only move through
        // GRN/bill workflows — never from a PO create payload.
        qtyReceived: 0,
        qtyBilled: 0,
        unitCost,
        taxRate,
        lineTotal: Math.round(qtyOrdered * unitCost * 100) / 100,
        accountCode: safeShortText(l.accountCode, 80),
      }
    })
}

/**
 * Map a client PATCH payload onto Prisma create-rows. Fulfilment counters are
 * filled in afterwards by `attachPoItemProgress` — the blob line id is often
 * not the Prisma item id, so matching has to wait until product ids are
 * resolved.
 */
export function mapPOItemsForUpdate(lines: any[]) {
  return lines
    .filter((l: any) => Boolean(optionalUuid(l.productId)))
    .map((l: any) => {
      const qtyOrdered = safeQty(l.qty)
      const unitCost = safeMoney(l.unitPrice)
      const taxRate = safeTaxRate(l.taxRate)
      return {
        sourceId: typeof l.id === 'string' ? l.id : undefined,
        productId: optionalUuid(l.productId),
        description: safeShortText(l.productName ?? l.description),
        qtyOrdered,
        qtyReceived: 0,
        qtyBilled: 0,
        unitCost,
        taxRate,
        lineTotal: Math.round(qtyOrdered * unitCost * 100) / 100,
        accountCode: safeShortText(l.accountCode, 80),
      }
    })
}

type ExistingPoItem = {
  id: string
  productId: string
  description?: string | null
  qtyReceived?: number
  qtyBilled?: number
}

/**
 * Copy qtyReceived/qtyBilled from the previous Prisma rows onto a replacement
 * line set. Matches by id, then product, then description / single remaining
 * line — the same fallbacks vendor bills use — so a blob PATCH cannot wipe
 * GRN/bill progress just because the line UUID changed.
 */
export function attachPoItemProgress<T extends {
  sourceId?: string
  productId?: string | null
  description?: string | null
  qtyOrdered: number
}>(
  lines: T[],
  existingItems: ExistingPoItem[],
): Array<Omit<T, 'sourceId'> & { qtyReceived: number; qtyBilled: number }> {
  const remaining = [...existingItems]
  return lines.map(line => {
    const { sourceId, ...rest } = line
    const match = resolveVendorBillPoItem(remaining, {
      purchaseOrderItemId: sourceId,
      productId: line.productId,
      description: line.description,
    })
    if (match) {
      const idx = remaining.findIndex(row => row.id === match.id)
      if (idx >= 0) remaining.splice(idx, 1)
    }
    const qtyOrdered = safeQty(rest.qtyOrdered)
    return {
      ...rest,
      qtyReceived: Math.min(qtyOrdered, Math.max(0, Number(match?.qtyReceived) || 0)),
      qtyBilled: Math.min(qtyOrdered, Math.max(0, Number(match?.qtyBilled) || 0)),
    }
  })
}

export function computePOTotals(items: Array<{ qtyOrdered?: unknown; unitCost?: unknown; taxRate?: unknown }>) {
  let subtotal = 0
  let taxAmount = 0
  for (const item of items) {
    const qty = safeQty(item.qtyOrdered)
    const unitCost = safeMoney(item.unitCost)
    const taxRate = safeTaxRate(item.taxRate)
    const lineSubtotal = Math.round(qty * unitCost * 100) / 100
    subtotal += lineSubtotal
    taxAmount += Math.round(lineSubtotal * taxRate) / 100
  }
  subtotal = Math.round(subtotal * 100) / 100
  taxAmount = Math.round(taxAmount * 100) / 100
  return { subtotal, taxAmount, totalAmount: Math.round((subtotal + taxAmount) * 100) / 100 }
}

/** Resolve/auto-create the vendor Client row and make sure it's flagged isVendor. */
export async function resolveVendorClientId(body: any): Promise<string> {
  const id = await resolveClientId(prisma, body.vendorId ?? body.clientId, { name: body.vendorName })
  await prisma.client.updateMany({ where: { id, isVendor: false }, data: { isVendor: true } })
  return id
}

/** Merge Prisma-authoritative fields into the deed_purchaseOrders blob mirror, one record at a time. */
export async function mirrorPurchaseOrder(prismaOrder: any, body: Record<string, unknown> = {}) {
  const state = await loadAppState(['deed_purchaseOrders'])
  const existing = Array.isArray(state.deed_purchaseOrders) ? (state.deed_purchaseOrders as any[]) : []
  const idx = existing.findIndex((p: any) => p.id === prismaOrder.id)
  const prevRecord = idx >= 0 ? existing[idx] : {}
  const passthrough: Record<string, unknown> = {}
  for (const key of PASSTHROUGH_KEYS) {
    // Receipt, billing and approval linkage is workflow-owned. Preserve the
    // existing server copy but never accept these fields from a client PO body.
    if (prevRecord[key] !== undefined) passthrough[key] = prevRecord[key]
  }
  void body
  const merged = { receiptIds: [], ...prevRecord, ...passthrough, ...mapPOToClient(prismaOrder) }
  const next = idx >= 0 ? existing.map((p: any, i: number) => (i === idx ? merged : p)) : [merged, ...existing]
  await saveStoreKeys({ deed_purchaseOrders: JSON.stringify(next) })
  return merged
}
