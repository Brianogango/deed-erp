import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { resolvePrismaProductIdForStock } from '@/lib/inventory/stock-transactions'
import { resolveVendorBillPoItem } from '@/lib/purchase/bill-po-line-match'

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
 * GRN validation can mark the blob PO fully received while Prisma
 * PurchaseOrderItem.qtyReceived stays 0 (blob-only PO, twin id, or a product
 * UUID that did not match the relational line). Confirm Vendor Bill then
 * 404s / 3-way-matches against unreceived Prisma lines. Copy blob received
 * qty forward; never decrease a relational counter.
 */
export async function syncPrismaPoReceivedFromBlob(prismaPoId: string, blobPoId?: string): Promise<void> {
  const state = await loadAppState(['deed_purchaseOrders'])
  const blob = Array.isArray(state.deed_purchaseOrders) ? (state.deed_purchaseOrders as any[]) : []
  const po = blob.find((row: any) => row?.id === blobPoId || row?.id === prismaPoId)
  if (!po || !Array.isArray(po.lines)) return

  const prismaPo = await prisma.purchaseOrder.findUnique({
    where: { id: prismaPoId },
    include: { items: true },
  })
  if (!prismaPo?.items.length) return

  const blobLines = po.lines.map((line: any) => ({
    id: String(line?.id ?? ''),
    productId: String(line?.productId ?? ''),
    description: String(line?.productName ?? line?.description ?? ''),
    qtyReceived: Math.max(0, Math.floor(Number(line?.qtyReceived) || 0)),
  }))

  let changed = false
  for (const item of prismaPo.items) {
    const matched = resolveVendorBillPoItem(
      blobLines.map(line => ({ id: line.id, productId: line.productId, description: line.description })),
      { productId: item.productId, description: item.description },
    )
    if (!matched) continue
    const blobLine = blobLines.find(line => line.id === matched.id)
    if (!blobLine) continue
    const next = Math.min(item.qtyOrdered, Math.max(item.qtyReceived, blobLine.qtyReceived))
    if (next === item.qtyReceived) continue
    await prisma.purchaseOrderItem.update({
      where: { id: item.id },
      data: { qtyReceived: next },
    })
    item.qtyReceived = next
    changed = true
  }

  if (!changed) return
  const allReceived = prismaPo.items.every(item => item.qtyReceived >= item.qtyOrdered)
  const anyReceived = prismaPo.items.some(item => item.qtyReceived > 0)
  if (!anyReceived) return
  await prisma.purchaseOrder.update({
    where: { id: prismaPoId },
    data: { status: allReceived ? 'received' : 'partial' },
  })
}

/**
 * Materialize a blob-only purchase order into Prisma (same id) so vendor
 * bills and GRN valuation can post. When the PO already exists under a
 * different id (blob-first create, then API re-create), returns the Prisma
 * twin's id — callers must use the returned id for FK references.
 * Returns null when the PO exists in neither store.
 */
export async function ensurePrismaPurchaseOrder(poId: string, actorUserId?: string | null): Promise<string | null> {
  if (!optionalUuid(poId)) return null
  const existing = await prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true } })
  if (existing) {
    await syncPrismaPoReceivedFromBlob(existing.id, poId)
    return existing.id
  }

  const state = await loadAppState(['deed_purchaseOrders'])
  const blob = Array.isArray(state.deed_purchaseOrders) ? (state.deed_purchaseOrders as any[]) : []
  const po = blob.find(p => p?.id === poId)
  if (!po) return null

  // Same PO number under a different id: link the twin, never duplicate.
  const poNumber = String(po.ref ?? po.poNumber ?? '').trim()
  if (poNumber) {
    const twin = await prisma.purchaseOrder.findUnique({ where: { poNumber }, select: { id: true } })
    if (twin) {
      console.warn(`[po-sync] blob PO ${poId} maps to existing Prisma PO ${twin.id} (${poNumber})`)
      await syncPrismaPoReceivedFromBlob(twin.id, poId)
      return twin.id
    }
  }

  const clientId = await resolveClientId(prisma, po.vendorId, { name: po.vendorName })
  await prisma.client.updateMany({ where: { id: clientId, isVendor: false }, data: { isVendor: true } })

  // created_by is a required FK — fall back to any active user when the
  // caller's id is not a Prisma user (e.g. a legacy/blob session id).
  let createdById = actorUserId && optionalUuid(actorUserId) ? actorUserId : null
  if (!createdById || !(await prisma.user.findUnique({ where: { id: createdById }, select: { id: true } }))) {
    const anyUser = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    createdById = anyUser?.id ?? null
  }
  if (!createdById) return null

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
  return poId
}
