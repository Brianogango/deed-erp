import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { saveStoreKeys } from '@/lib/server-store'
import { paginationParams } from '@/lib/api/pagination'

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch {}
}

const SALES_ORDER_STATUSES = new Set(['quotation', 'confirmed', 'delivered', 'invoiced', 'cancelled', 'pending'])

function normalizeSaleOrderStatus(status: unknown) {
  if (typeof status !== 'string' || status.trim() === '') return 'quotation'
  const normalized = status.trim()
  return SALES_ORDER_STATUSES.has(normalized) ? normalized : 'quotation'
}

function mapSaleOrderToClient(order: any) {
  return {
    ...order,
    ref: order.orderNumber,
    customerId: order.clientId,
    customerName: order.client?.name ?? '',
    date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
    deliveryDate: order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : undefined,
    total: Number(order.totalAmount ?? 0),
    taxTotal: Number(order.taxAmount ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    discountAmount: Number(order.discountAmount ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
    lines: (order.items ?? []).map((item: any) => ({
      id: item.id,
      productId: item.productId ?? '',
      productName: item.description ?? '',
      description: item.description ?? '',
      qty: Number(item.qty ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      taxRate: Number(item.taxRate ?? 0),
      subtotal: Number(item.lineTotal ?? 0),
      lineTotal: Number(item.lineTotal ?? 0),
      serialIds: item.serialNumberId ? [item.serialNumberId] : [],
      notes: item.notes ?? undefined,
      qtyDelivered: Number(item.qtyDelivered ?? 0),
    })),
  }
}

function mapSaleOrderItems(lines: any[]) {
  return lines.map((item: any) => ({
    productId: optionalUuid(item.productId),
    description: item.description ?? item.productName ?? 'Item',
    qty: Number(item.qty ?? 1),
    unitPrice: Number(item.unitPrice ?? 0),
    taxRate: Number(item.taxRate ?? 0),
    lineTotal: Number(item.lineTotal ?? item.subtotal ?? 0),
    notes: item.notes ?? null,
    serialNumberId: optionalUuid(item.serialNumberId ?? item.serialIds?.[0]),
  }))
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const { page, limit, skip, q, status, requested } = paginationParams(request.url)

    const where: any = {
      ...(status ? { status } : {}),
      ...(q ? {
          OR: [
            { orderNumber: { contains: q, mode: 'insensitive' } },
            { client: { name: { contains: q, mode: 'insensitive' } } }
          ]
        } : {})
    }
    const orders = await prisma.saleOrder.findMany({
      where,
      include: {
        client: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
      ...(requested ? { skip, take: limit } : {}),
    })

    const mapped = orders.map(mapSaleOrderToClient)
    if (!requested) return NextResponse.json(mapped)
    const total = await prisma.saleOrder.count({ where })
    return NextResponse.json({ items: mapped, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

    const rawItems: any[] = body.items ?? body.lines ?? []
    const clientId = await resolveClientId(prisma, body.clientId ?? body.customerId, body)
    let orderNumber = body.orderNumber ?? body.ref

    if (!orderNumber) {
      const soCount = await prisma.saleOrder.count()
      orderNumber = `SO-${String(soCount + 1).padStart(5, '0')}`
    }

    const order = await prisma.saleOrder.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        orderNumber,
        clientId,
        createdById: session.user.id,
        status: normalizeSaleOrderStatus(body.status),
        orderDate: new Date(body.orderDate ?? body.date ?? Date.now()),
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
        subtotal: Number(body.subtotal ?? 0),
        taxAmount: Number(body.taxAmount ?? body.taxTotal ?? 0),
        discountAmount: Number(body.discountAmount ?? 0),
        totalAmount: Number(body.totalAmount ?? body.total ?? 0),
        amountPaid: Number(body.amountPaid ?? 0),
        notes: body.notes ?? null,
        quoteId: optionalUuid(body.quoteId),
        items: {
          create: mapSaleOrderItems(rawItems),
        },
      },
      include: { client: true, items: true },
    })

    void broadcastSaleOrders()
    return NextResponse.json(mapSaleOrderToClient(order), { status: 201 })
  })
}
