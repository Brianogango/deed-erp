import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Map frontend QuoteStatus to valid DocumentStatus enum values
const QUOTE_STATUS_MAP: Record<string, string> = {
  sent:     'pending_approval',
  viewed:   'pending_approval',
  accepted: 'approved',
  expired:  'cancelled',
  revised:  'draft',
}

function mapQuoteBodyToDb(body: any) {
  const rawStatus = body.status ?? 'draft'
  const status = QUOTE_STATUS_MAP[rawStatus] ?? rawStatus

  let quoteDate: Date | undefined
  if (body.quoteDate) quoteDate = new Date(body.quoteDate)
  else if (body.issueDate) quoteDate = new Date(body.issueDate)

  return {
    quoteNumber: body.quoteNumber ?? body.ref,
    clientId: body.clientId ?? body.companyId,
    assignedToId: body.assignedToId ?? null,
    opportunityId: body.opportunityId ?? null,
    status,
    quoteDate,
    validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
    subject: body.subject ?? null,
    subtotal: Number(body.subtotal ?? 0),
    taxAmount: Number(body.taxAmount ?? 0),
    discountAmount: Number(body.discountAmount ?? 0),
    discountPct: Number(body.discountPct ?? 0),
    totalAmount: Number(body.totalAmount ?? body.total ?? 0),
    notes: body.notes ?? null,
    internalNotes: body.internalNotes ?? null,
    terms: body.terms ?? null,
    createdById: body.createdById ?? body.createdBy,
  }
}

function mapQuoteItems(lines: any[]) {
  return lines.map((l: any) => ({
    description: l.description ?? l.productName ?? '',
    qty: Number(l.qty ?? 1),
    unitPrice: Number(l.unitPrice ?? 0),
    discountPct: Number(l.discount ?? l.discountPct ?? 0),
    taxRate: Number(l.taxRate ?? 0),
    lineSubtotal: Number(l.subtotal ?? l.lineSubtotal ?? 0),
    lineTax: Number(l.lineTax ?? 0),
    lineTotal: Number(l.lineTotal ?? l.subtotal ?? 0),
    ...(l.productId ? { productId: l.productId } : {}),
  }))
}

export async function GET() {
  try {
    const quotes = await prisma.quote.findMany({
      include: { items: true, client: true, opportunity: true },
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
    const lines: any[] = body.lines ?? body.items ?? []

    let quoteNumber = body.quoteNumber ?? body.ref
    if (!quoteNumber) {
      const count = await prisma.quote.count()
      quoteNumber = `QTE-${String(count + 1).padStart(5, '0')}`
    }

    const quote = await prisma.quote.create({
      data: {
        ...mapQuoteBodyToDb(body),
        quoteNumber,
        items: { create: mapQuoteItems(lines) },
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
    const { id, lines, ...rest } = body
    const linesData: any[] | undefined = lines ?? undefined

    const mapped = mapQuoteBodyToDb(rest)
    // Don't overwrite quoteNumber on updates (it's unique and set at create)
    const { quoteNumber: _qn, ...updateData } = mapped

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        ...updateData,
        ...(linesData !== undefined ? {
          items: {
            deleteMany: {},
            create: mapQuoteItems(linesData),
          }
        } : {}),
      },
      include: { items: true },
    })
    return NextResponse.json(quote)
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
