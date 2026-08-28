import 'server-only'
import prisma from '@/lib/prisma'
import { resolveClientId, optionalUuid } from '@/lib/legacy-compat'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'

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

export function mapPOItemsForCreate(lines: any[]) {
  return lines
    .filter((l: any) => Boolean(optionalUuid(l.productId)))
    .map((l: any) => ({
      productId: optionalUuid(l.productId),
      description: l.productName ?? l.description ?? null,
      qtyOrdered: Math.max(0, Math.floor(Number(l.qty) || 0)),
      qtyReceived: Math.max(0, Math.floor(Number(l.qtyReceived) || 0)),
      qtyBilled: Math.max(0, Math.floor(Number(l.qtyBilled) || 0)),
      unitCost: Math.max(0, Number(l.unitPrice) || 0),
      taxRate: Math.max(0, Number(l.taxRate) || 0),
      lineTotal: Math.max(0, Number(l.subtotal) || 0),
      accountCode: l.accountCode ?? null,
    }))
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
    if (body[key] !== undefined) passthrough[key] = body[key]
    else if (prevRecord[key] !== undefined) passthrough[key] = prevRecord[key]
  }
  const merged = { receiptIds: [], ...prevRecord, ...passthrough, ...mapPOToClient(prismaOrder) }
  const next = idx >= 0 ? existing.map((p: any, i: number) => (i === idx ? merged : p)) : [merged, ...existing]
  await saveStoreKeys({ deed_purchaseOrders: JSON.stringify(next) })
  return merged
}
