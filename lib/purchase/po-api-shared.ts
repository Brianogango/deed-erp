import 'server-only'
import prisma from '@/lib/prisma'
import { resolveClientId, optionalUuid } from '@/lib/legacy-compat'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'
import { mergeScreenExtras, PO_EXTRA_KEYS, PO_LINE_EXTRA_KEYS, readScreenExtras } from '@/lib/screen-extras'

/**
 * Shared helpers for the purchase-order API routes. Next.js route files may
 * only export HTTP handlers + config, so these live here — never in a
 * route.ts (the route type check fails the production build otherwise).
 */
export const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']

/**
 * Screen fields a PO create / edit may set. The receipt and bill links are
 * not among them: they come from the receipts and bills that point at the
 * order (see lib/purchase-order-read-model.server.ts).
 */
export const PO_WRITABLE_EXTRA_KEYS = PO_EXTRA_KEYS.filter(k => k !== 'receiptIds' && k !== 'billId')

function mapPOLineToClient(item: any) {
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
    ...readScreenExtras(item.screenExtras, PO_LINE_EXTRA_KEYS),
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
    receiptIds: [] as string[],
    ...readScreenExtras(po.screenExtras, PO_EXTRA_KEYS),
    lockVersion: Number(po.lockVersion ?? 0),
  }
}

/** Line screen fields (import serials, specs) for a create, or merged onto the stored ones. */
export function poLineExtras(line: unknown, stored?: unknown) {
  return mergeScreenExtras(stored, line, PO_LINE_EXTRA_KEYS) ?? undefined
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
        screenExtras: poLineExtras(l),
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

/**
 * The saved order as the screens show it, and a nudge to open tabs to re-read
 * purchase orders. The deed_purchaseOrders screen copy is frozen; the table
 * is the source.
 */
export async function publishPurchaseOrder(prismaOrder: any) {
  await notifyStoreKeysChanged(['deed_purchaseOrders'])
  return mapPOToClient(prismaOrder)
}
