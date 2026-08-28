import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'
import { resolvePOLineProducts } from '@/lib/purchase/po-prisma-sync'
import { WRITE_ROLES, mapPOToClient, mapPOItemsForCreate, resolveVendorClientId, mirrorPurchaseOrder } from '@/lib/purchase/po-api-shared'

// Purchase Orders were entirely blob-only (deed_purchaseOrders via generic
// JSON-collection CRUD) despite PurchaseOrder/PurchaseOrderItem existing as
// unused Prisma models. This is a real relational write path now — Prisma is
// authoritative for ref/status/vendor/dates/lines/totals/lockVersion — but
// GRN receiving, billing, and PO-approval-request linkage are not migrated
// in this pass, so those specific fields (receiptIds, billId,
// approvalStatus, approvalRequestIds, repairId/repairRef/
// procurementRequestId) are carried through from the client body / the
// existing blob record rather than derived from Prisma.
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
    // Auto-create catalog products missing from Prisma instead of dying on a
    // P2003 FK violation — a blob-only product must not orphan the whole PO.
    const items = await resolvePOLineProducts(mapPOItemsForCreate(Array.isArray(body.lines) ? body.lines : []))
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
