import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const body = await request.json()
    const { lines, ...quoteData } = body

    if (quoteData.issueDate) quoteData.issueDate = new Date(quoteData.issueDate)
    if (quoteData.validUntil) quoteData.validUntil = new Date(quoteData.validUntil)

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        ...quoteData,
        lines: lines ? {
          deleteMany: {},
          create: lines.map((l: any) => ({
            id: l.id,
            productId: l.productId,
            productName: l.productName,
            sku: l.sku,
            description: l.description,
            qty: l.qty,
            unit: l.unit,
            listPrice: l.listPrice,
            unitPrice: l.unitPrice,
            discount: l.discount,
            taxRate: l.taxRate,
            subtotal: l.subtotal,
            lineTotal: l.lineTotal
          }))
        } : undefined
      },
      include: { lines: true }
    })
    return NextResponse.json(quote)
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}