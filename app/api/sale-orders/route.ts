import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { saveStoreKeys } from '@/lib/server-store'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch {}
}

function mapSaleOrderToClient(order: any) {
  return {
    ...order,
    ref: order.orderNumber,
    customerId: order.clientId,
    customerName: order.client?.name ?? '',
    date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
    deliveryDate: order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : undefined,
    validUntil: order.validUntil ? new Date(order.validUntil).toISOString().slice(0, 10) : undefined,
    status: normalizeSaleStatus(order.status),
    sentAt: order.sentAt ? new Date(order.sentAt).toISOString() : undefined,
    confirmedAt: order.confirmedAt ? new Date(order.confirmedAt).toISOString() : undefined,
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
      qtyInvoiced: Number(item.qtyInvoiced ?? 0),
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
    qtyInvoiced: Number(item.qtyInvoiced ?? 0),
  }))
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')

    const orders = await prisma.saleOrder.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? {
          OR: [
            { orderNumber: { contains: q, mode: 'insensitive' } },
            { client: { name: { contains: q, mode: 'insensitive' } } }
          ]
        } : {})
      },
      include: {
        client: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(orders.map(mapSaleOrderToClient))
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
      orderNumber = await getNextDocNumber('sale_order')
    }

    const order = await prisma.saleOrder.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        orderNumber,
        clientId,
        createdById: session.user.id,
        status: normalizeSaleStatus(body.status),
        orderDate: new Date(body.orderDate ?? body.date ?? Date.now()),
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        subtotal: Number(body.subtotal ?? 0),
        taxAmount: Number(body.taxAmount ?? body.taxTotal ?? 0),
        discountAmount: Number(body.discountAmount ?? 0),
        totalAmount: Number(body.totalAmount ?? body.total ?? 0),
        amountPaid: Number(body.amountPaid ?? 0),
        notes: body.notes ?? null,
        customerRef: body.customerRef ?? null,
        invoiceAddress: body.invoiceAddress ?? null,
        deliveryAddress: body.deliveryAddress ?? null,
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
