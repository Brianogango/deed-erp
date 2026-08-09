import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { resolveClientId, optionalUuid } from '@/lib/legacy-compat'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'

// Purchase Orders were entirely blob-only (deed_purchaseOrders via generic
// JSON-collection CRUD) despite PurchaseOrder/PurchaseOrderItem existing as
// unused Prisma models. This is a real relational write path now — Prisma is
// authoritative for ref/status/vendor/dates/lines/totals/lockVersion — but
// GRN receiving, billing, and PO-approval-request linkage are not migrated
// in this pass, so those specific fields (receiptIds, billId,
// approvalStatus, approvalRequestIds, repairId/repairRef/
// procurementRequestId) are carried through from the client body / the
// existing blob record rather than derived from Prisma.
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

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')
    const { page, limit, skip, sort, order } = parsePaginationParams(searchParams, {
      defaultSort: 'orderDate',
      allowedSorts: ['orderDate', 'createdAt', 'updatedAt', 'totalAmount', 'poNumber'],
    })
    const where = {
      ...(status ? { status: status as any } : {}),
      ...(q
        ? {
            OR: [
              { poNumber: { contains: q, mode: 'insensitive' as const } },
              { vendor: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    }
    const [total, orders] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: { vendor: true, items: { include: { product: true } } },
        orderBy: { [sort ?? 'orderDate']: order },
        skip,
        take: limit,
      }),
    ])
    return NextResponse.json(paginatedResponse(orders.map(mapPOToClient), total, page, limit))
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
    }
    const body = await request.json()
    if (!body.vendorName && !body.vendorId) {
      return NextResponse.json({ error: 'vendorName is required' }, { status: 400 })
    }
    const clientId = await resolveVendorClientId(body)
    const items = mapPOItemsForCreate(Array.isArray(body.lines) ? body.lines : [])
    const poNumber = body.ref || (await getNextDocNumber('purchase_order'))

    const created = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        clientId,
        status: body.status ?? 'draft',
        orderDate: body.date ? new Date(body.date) : new Date(),
        expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
        subtotal: Math.max(0, Number(body.subtotal) || 0),
        taxAmount: Math.max(0, Number(body.taxTotal ?? body.taxAmount) || 0),
        totalAmount: Math.max(0, Number(body.total ?? body.totalAmount) || 0),
        notes: body.notes ?? null,
        createdById: session.user.id,
        items: { create: items },
      } as any,
      include: { vendor: true, items: { include: { product: true } } },
    })
    const mirrored = await mirrorPurchaseOrder(created, body)
    return NextResponse.json(mirrored, { status: 201 })
  })
}
