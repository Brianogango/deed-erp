import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const quote = await prisma.quote.findUnique({ where: { id: params.id }, include: { items: true } })
    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(quote)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { lines, items, id: _id, ...rest } = body
    const linesData = lines ?? items ?? []

    if (rest.issueDate && !rest.quoteDate) rest.quoteDate = new Date(rest.issueDate)
    else if (rest.quoteDate) rest.quoteDate = new Date(rest.quoteDate)
    delete rest.issueDate
    if (rest.validUntil) rest.validUntil = new Date(rest.validUntil)
    // Remove undefined fields that Prisma can't handle
    Object.keys(rest).forEach(k => rest[k] === undefined && delete rest[k])

    const quote = await prisma.quote.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(linesData.length > 0 ? {
          items: {
            deleteMany: {},
            create: linesData.map((l: any) => ({
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
        } : {}),
      },
      include: { items: true },
    })
    return NextResponse.json(quote)
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.quote.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  })
}
