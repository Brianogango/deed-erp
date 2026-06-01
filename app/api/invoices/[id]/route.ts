import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:        'approved',
  partial:       'partially_paid',
  pending:       'pending_approval',
  sent:          'pending_approval',
  open:          'approved',
}

function mapInvoiceUpdateToDb(body: any) {
  const rawStatus = body.status
  const status = rawStatus ? (INVOICE_STATUS_MAP[rawStatus] ?? rawStatus) : undefined

  let invoiceDate: Date | undefined
  if (body.invoiceDate) invoiceDate = new Date(body.invoiceDate)
  else if (body.date) invoiceDate = new Date(body.date)

  const data: Record<string, any> = {
    clientId: body.clientId ?? body.partnerId ?? undefined,
    saleOrderId: body.saleOrderId ?? undefined,
    repairId: body.repairId ?? undefined,
    subject: body.subject ?? undefined,
    subtotal: body.subtotal !== undefined ? Number(body.subtotal) : undefined,
    taxAmount: body.taxAmount !== undefined ? Number(body.taxAmount)
               : body.taxTotal !== undefined ? Number(body.taxTotal) : undefined,
    discountAmount: body.discountAmount !== undefined ? Number(body.discountAmount) : undefined,
    totalAmount: body.totalAmount !== undefined ? Number(body.totalAmount)
                 : body.total !== undefined ? Number(body.total) : undefined,
    amountPaid: body.amountPaid !== undefined ? Number(body.amountPaid) : undefined,
    notes: body.notes ?? undefined,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    invoiceDate,
    status,
  }
  // Strip undefined so Prisma ignores unset fields on partial updates
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k])
  return data
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

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json()
    const lines: any[] | undefined = body.lines ?? body.items ?? undefined

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...mapInvoiceUpdateToDb(body),
        ...(lines !== undefined ? {
          items: {
            deleteMany: {},
            create: mapInvoiceItems(lines),
          }
        } : {}),
      },
      include: { items: true },
    })
    return NextResponse.json(invoice)
  } catch (error) {
    console.error('[API_INVOICES_PUT]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.invoice.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
