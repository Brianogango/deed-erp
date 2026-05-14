import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const invoices = await prisma.invoice.findMany({
      include: { items: true },
      orderBy: { invoiceDate: 'desc' },
    })
    return NextResponse.json(invoices)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const { lines, ...invoiceData } = body
    // Support both old `date` field and new `invoiceDate`
    if (invoiceData.date && !invoiceData.invoiceDate) {
      invoiceData.invoiceDate = new Date(invoiceData.date)
    } else if (invoiceData.invoiceDate) {
      invoiceData.invoiceDate = new Date(invoiceData.invoiceDate)
    }
    delete invoiceData.date
    if (invoiceData.dueDate) invoiceData.dueDate = new Date(invoiceData.dueDate)

    const invoice = await prisma.invoice.create({
      data: {
        ...invoiceData,
        items: {
          create: (lines ?? []).map((l: any) => ({
            description: l.description ?? '',
            qty: l.qty ?? 1,
            unitPrice: l.unitPrice ?? 0,
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
    return NextResponse.json(invoice, { status: 201 })
  })
}
