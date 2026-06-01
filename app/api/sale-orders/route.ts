import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { resolveClientId } from '@/lib/legacy-compat'

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
    const transformed = orders.map((o: any) => ({
      ...o,
      ref: o.orderNumber,
      customerId: o.clientId,
      customerName: o.client?.name ?? '',
      date: o.orderDate ? new Date(o.orderDate).toISOString().slice(0, 10) : '',
      total: o.totalAmount,
      taxTotal: o.taxAmount,
      lines: (o.items ?? []).map((item: any) => ({
        id: item.id,
        productId: item.productId ?? '',
        productName: item.description ?? '',
        description: item.description ?? '',
        qty: item.qty,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 0,
        subtotal: item.lineTotal,
        lineTotal: item.lineTotal,
      })),
    }))
    return NextResponse.json(transformed)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

    // Accept both frontend field aliases and canonical DB names
    const rawItems: any[] = body.items ?? body.lines ?? []
    const clientId = await resolveClientId(prisma, body.clientId ?? body.customerId, body)
    let orderNumber = body.orderNumber ?? body.ref

    if (!orderNumber) {
      const soCount = await prisma.saleOrder.count()
      orderNumber = `SO-${String(soCount + 1).padStart(5, '0')}`
    }

    const order = await prisma.saleOrder.create({
      data: {
        orderNumber,
        clientId,
        createdById: session.user.id,
        status: body.status ?? 'pending',
        orderDate: new Date(body.orderDate ?? body.date ?? Date.now()),
        subtotal: Number(body.subtotal ?? 0),
        taxAmount: Number(body.taxAmount ?? body.taxTotal ?? 0),
        discountAmount: Number(body.discountAmount ?? 0),
        totalAmount: Number(body.totalAmount ?? body.total ?? 0),
        amountPaid: Number(body.amountPaid ?? 0),
        notes: body.notes ?? null,
        items: {
          create: rawItems.map((item: any) => ({
            productId: item.productId || undefined,
            description: item.description ?? item.productName ?? 'Item',
            qty: Number(item.qty ?? 1),
            unitPrice: Number(item.unitPrice ?? 0),
            taxRate: Number(item.taxRate ?? 0),
            lineTotal: Number(item.lineTotal ?? item.subtotal ?? 0),
            notes: item.notes ?? null,
            serialNumberId: item.serialNumberId || item.serialIds?.[0] || undefined,
          }))
        }
      },
      include: { items: true },
    })
    return NextResponse.json(order, { status: 201 })
  })
}
