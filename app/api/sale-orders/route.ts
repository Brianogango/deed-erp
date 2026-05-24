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
    return NextResponse.json(orders)
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
