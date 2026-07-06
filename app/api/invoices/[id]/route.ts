import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { computeInvoiceTotals } from '@/lib/finance-invoice'
import { writeFinancialAudit } from '@/lib/finance-audit'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:        'approved',
  partial:       'partially_paid',
  pending:       'pending_approval',
  sent:          'pending_approval',
  open:          'approved',
}

const VALID_STATUSES = new Set([
  'draft', 'pending_approval', 'approved', 'rejected', 'invoiced',
  'dispatched', 'delivered', 'paid', 'partially_paid', 'cancelled', 'voided',
])

function mapInvoiceUpdateToDb(body: any, clientId?: string) {
  const rawStatus = body.status
  const mappedStatus = rawStatus ? (INVOICE_STATUS_MAP[rawStatus] ?? rawStatus) : undefined
  const status = mappedStatus && VALID_STATUSES.has(mappedStatus) ? mappedStatus : undefined

  let invoiceDate: Date | undefined
  if (body.invoiceDate) invoiceDate = new Date(body.invoiceDate)
  else if (body.date) invoiceDate = new Date(body.date)

  // When line items are supplied, recompute all totals server-side. Never accept
  // header totals or `amountPaid` directly on update — amountPaid is owned by the
  // payments endpoint, and totals must always tie back to the line items.
  const lines: any[] | undefined = body.lines ?? body.items ?? undefined
  const totals = lines !== undefined
    ? computeInvoiceTotals(lines, { headerTax: body.taxAmount ?? body.taxTotal, discount: body.discountAmount })
    : undefined

  const data: Record<string, any> = {
    clientId,
    saleOrderId: body.saleOrderId !== undefined ? optionalUuid(body.saleOrderId) ?? null : undefined,
    repairId: body.repairId !== undefined ? optionalUuid(body.repairId) ?? null : undefined,
    subject: body.subject ?? undefined,
    subtotal: totals?.subtotal,
    taxAmount: totals?.taxAmount,
    discountAmount: totals?.discountAmount,
    totalAmount: totals?.totalAmount,
    notes: body.notes ?? undefined,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    invoiceDate,
    status,
  }
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
    ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
  }))
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { items: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(invoice)
  })
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const body = await request.json()
    const lines: any[] | undefined = body.lines ?? body.items ?? undefined
    const clientId = (body.clientId !== undefined || body.partnerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.partnerId, body)
      : undefined

    const before = await prisma.invoice.findUnique({ where: { id: params.id } })

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...mapInvoiceUpdateToDb(body, clientId),
        ...(lines !== undefined ? {
          items: {
            deleteMany: {},
            create: mapInvoiceItems(lines),
          }
        } : {}),
      },
      include: { items: true },
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'update_invoice',
      entityType: 'invoice',
      entityId: invoice.id,
      oldValues: before ? { status: before.status, totalAmount: before.totalAmount, amountPaid: before.amountPaid } : undefined,
      newValues: { status: invoice.status, totalAmount: invoice.totalAmount, amountPaid: invoice.amountPaid },
    })

    return NextResponse.json(invoice)
  })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

// Invoices are financial records and are never hard-deleted — doing so would
// destroy audit history and break GL reconciliation. Instead we transition the
// invoice to a terminal `voided`/`cancelled` status and record who did it.
// A fully-paid invoice cannot be voided; it must be credited/refunded instead.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)

    const invoice = await prisma.invoice.findUnique({ where: { id: params.id } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (Number(invoice.amountPaid) > 0) {
      return NextResponse.json(
        { error: 'Paid invoices cannot be voided. Issue a credit note or refund instead.' },
        { status: 409 },
      )
    }
    if (invoice.status === 'voided' || invoice.status === 'cancelled') {
      return NextResponse.json({ ok: true, invoice })
    }

    const voided = await prisma.invoice.update({
      where: { id: params.id },
      data: { status: 'voided' as any },
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'void_invoice',
      entityType: 'invoice',
      entityId: invoice.id,
      oldValues: { status: invoice.status, totalAmount: invoice.totalAmount },
      newValues: { status: 'voided' },
    })

    return NextResponse.json({ ok: true, invoice: voided })
  })
}
