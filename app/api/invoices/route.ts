import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

// Map frontend status aliases to valid DocumentStatus enum values
const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:        'approved',
  partial:       'partially_paid',
  pending:       'pending_approval',
  sent:          'pending_approval',
  open:          'approved',
}

function mapInvoiceBodyToDb(body: any) {
  const rawStatus = body.status ?? 'draft'
  const status = INVOICE_STATUS_MAP[rawStatus] ?? rawStatus

  // Date handling: accept date/invoiceDate aliases
  let invoiceDate: Date | undefined
  if (body.invoiceDate) invoiceDate = new Date(body.invoiceDate)
  else if (body.date) invoiceDate = new Date(body.date)

  return {
    invoiceNumber: body.invoiceNumber ?? body.ref,
    clientId: body.clientId ?? body.partnerId,
    saleOrderId: body.saleOrderId ?? null,
    repairId: body.repairId ?? null,
    quoteId: body.quoteId ?? null,
    status,
    invoiceDate,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    subject: body.subject ?? null,
    subtotal: Number(body.subtotal ?? 0),
    taxAmount: Number(body.taxAmount ?? body.taxTotal ?? 0),
    discountAmount: Number(body.discountAmount ?? 0),
    totalAmount: Number(body.totalAmount ?? body.total ?? 0),
    amountPaid: Number(body.amountPaid ?? 0),
    notes: body.notes ?? null,
  }
}

function mapInvoiceItems(lines: any[]) {
  return lines.map((l: any) => ({
    description: l.description ?? '',
    qty: Number(l.qty ?? 1),
    unitPrice: Number(l.unitPrice ?? 0),
    taxRate: Number(l.taxRate ?? 0),
    lineSubtotal: Number(l.subtotal ?? l.lineSubtotal ?? 0),
    lineTax: Number(l.lineTax ?? 0),
    lineTotal: Number(l.lineTotal ?? l.subtotal ?? 0),
    ...(l.productId ? { productId: l.productId } : {}),
  }))
}

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
    const lines: any[] = body.lines ?? body.items ?? []

    let invoiceNumber = body.invoiceNumber ?? body.ref
    if (!invoiceNumber) {
      const count = await prisma.invoice.count()
      invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`
    }

    const invoice = await prisma.invoice.create({
      data: {
        ...mapInvoiceBodyToDb(body),
        invoiceNumber,
        items: { create: mapInvoiceItems(lines) },
      },
      include: { items: true },
    })
    return NextResponse.json(invoice, { status: 201 })
  })
}
