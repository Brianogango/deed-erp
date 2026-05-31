import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

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
    // Transform Prisma data to match the frontend SaleOrder type
    const transformed = orders.map((o: any) => ({
      ...o,
      // Aliases for frontend compatibility
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
    const { items, ...orderData } = body

    const order = await prisma.saleOrder.create({
      data: {
        ...orderData,
        createdById: session.user.id,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            description: item.description,
            qty: item.qty,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            lineTotal: item.lineTotal,
            notes: item.notes,
            serialNumberId: item.serialNumberId,
          }))
        }
      },
      include: {
        items: true,
      }
    })
    return NextResponse.json(order, { status: 201 })
  })
}
