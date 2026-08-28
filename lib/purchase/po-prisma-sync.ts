import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { resolvePrismaProductIdForStock } from '@/lib/inventory/stock-transactions'

type BlobProduct = {
  id?: string
  sku?: string
  name?: string
  costPrice?: number
  sellingPrice?: number
  salePrice?: number
  requiresSerial?: boolean
  trackingMethod?: string
}

async function blobProductsById(): Promise<Map<string, BlobProduct>> {
  const state = await loadAppState(['deed_products'])
  const products = Array.isArray(state.deed_products) ? (state.deed_products as BlobProduct[]) : []
  return new Map(products.filter(p => p?.id).map(p => [String(p.id), p]))
}

/**
 * Resolve PO line product ids onto Prisma products, auto-creating catalog
 * products that never made it into Prisma (long vendor titles, blob-only
 * imports). Without this the whole PO write dies on a P2003 FK violation.
 */
export async function resolvePOLineProducts<T extends { productId?: string | null; description?: string | null }>(
  items: T[],
): Promise<T[]> {
  const byId = await blobProductsById()
  const out: T[] = []
  for (const item of items) {
    if (!item.productId) { out.push(item); continue }
    const hint = byId.get(String(item.productId))
    const resolved = await resolvePrismaProductIdForStock(prisma, String(item.productId), {
      sku: hint?.sku,
      name: hint?.name ?? item.description ?? undefined,
      requiresSerial: hint?.requiresSerial,
      trackingMethod: hint?.trackingMethod,
      costPrice: hint?.costPrice,
      sellingPrice: hint?.sellingPrice ?? hint?.salePrice,
    })
    out.push({ ...item, productId: resolved ?? null })
  }
  return out
}

/**
 * Materialize a blob-only purchase order into Prisma (same id) so vendor
 * bills and GRN valuation can post. Returns true when the PO exists after
 * the call. Never overwrites an existing Prisma PO.
 */
export async function ensurePrismaPurchaseOrder(poId: string, actorUserId?: string | null): Promise<boolean> {
  if (!optionalUuid(poId)) return false
  const existing = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true } })
  if (existing) return true

  const state = await loadAppState(['deed_purchaseOrders'])
  const blob = Array.isArray(state.deed_purchaseOrders) ? (state.deed_purchaseOrders as any[]) : []
  const po = blob.find(p => p?.id === poId)
  if (!po) return false

  const clientId = await resolveClientId(prisma, po.vendorId, { name: po.vendorName })
  await prisma.client.updateMany({ where: { id: clientId, isVendor: false }, data: { isVendor: true } })

  // created_by is a required FK — fall back to any active user when the
  // caller's id is not a Prisma user (e.g. a legacy/blob session id).
  let createdById = actorUserId && optionalUuid(actorUserId) ? actorUserId : null
  if (!createdById || !(await prisma.user.findUnique({ where: { id: createdById }, select: { id: true } }))) {
    const anyUser = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    createdById = anyUser?.id ?? null
  }
  if (!createdById) return false

  const rawLines = (Array.isArray(po.lines) ? po.lines : [])
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
  const items = await resolvePOLineProducts(rawLines)

  await prisma.purchaseOrder.create({
    data: {
      id: poId,
      poNumber: String(po.ref ?? po.poNumber ?? `PO-${poId.slice(0, 8)}`),
      clientId,
      status: String(po.status ?? 'draft') as any,
      orderDate: po.date ? new Date(po.date) : new Date(),
      expectedDate: po.expectedDate ? new Date(po.expectedDate) : null,
      subtotal: Math.max(0, Number(po.subtotal) || 0),
      taxAmount: Math.max(0, Number(po.taxTotal ?? po.taxAmount) || 0),
      totalAmount: Math.max(0, Number(po.total ?? po.totalAmount) || 0),
      notes: po.notes ? String(po.notes) : null,
      createdById,
      items: items.length ? { create: items.filter(i => i.productId) } : undefined,
    } as any,
  })
  console.warn(`[po-sync] materialized blob-only purchase order ${po.ref ?? poId} into Prisma`)
  return true
}
