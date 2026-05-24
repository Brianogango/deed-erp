import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET() {
  try {
    const quotes = await prisma.quote.findMany({
      include: { 
        items: true,
        client: true,
        opportunity: true
      },
      orderBy: { quoteDate: 'desc' },
    })
    return NextResponse.json(quotes)
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { lines, ...quoteData } = body

    // Support both old `issueDate` and new `quoteDate`
    if (quoteData.issueDate && !quoteData.quoteDate) {
      quoteData.quoteDate = new Date(quoteData.issueDate)
    } else if (quoteData.quoteDate) {
      quoteData.quoteDate = new Date(quoteData.quoteDate)
    }
    delete quoteData.issueDate
    if (quoteData.validUntil) quoteData.validUntil = new Date(quoteData.validUntil)

    const quote = await prisma.quote.create({
      data: {
        ...quoteData,
        items: {
          create: (lines ?? []).map((l: any) => ({
            description: l.description ?? l.productName ?? '',
            qty: l.qty ?? 1,
            unitPrice: l.unitPrice ?? 0,
            discountPct: l.discount ?? l.discountPct ?? 0,
            taxRate: l.taxRate ?? 0,
            lineSubtotal: l.subtotal ?? l.lineSubtotal ?? 0,
            lineTax: l.lineTax ?? 0,
            lineTotal: l.lineTotal ?? l.subtotal ?? 0,
            ...(l.productId ? { productId: l.productId } : {}),
          })),
        },
      },
      include: { items: true },
    })
    return NextResponse.json(quote, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { id, lines, ...quoteData } = body

    if (quoteData.issueDate && !quoteData.quoteDate) {
      quoteData.quoteDate = new Date(quoteData.issueDate)
    } else if (quoteData.quoteDate) {
      quoteData.quoteDate = new Date(quoteData.quoteDate)
    }
    delete quoteData.issueDate
    if (quoteData.validUntil) quoteData.validUntil = new Date(quoteData.validUntil)

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        ...quoteData,
        items: lines
          ? {
              deleteMany: {},
              create: lines.map((l: any) => ({
                description: l.description ?? l.productName ?? '',
                qty: l.qty ?? 1,
                unitPrice: l.unitPrice ?? 0,
                discountPct: l.discount ?? l.discountPct ?? 0,
                taxRate: l.taxRate ?? 0,
                lineSubtotal: l.subtotal ?? l.lineSubtotal ?? 0,
                lineTax: l.lineTax ?? 0,
                lineTotal: l.lineTotal ?? l.subtotal ?? 0,
                ...(l.productId ? { productId: l.productId } : {}),
              })),
            }
          : undefined,
      },
      include: { items: true },
    })
    return NextResponse.json(quote)
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
