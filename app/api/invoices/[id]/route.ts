import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { computeInvoiceTotals } from '@/lib/finance-invoice'
import { writeFinancialAudit } from '@/lib/finance-audit'

// technical_lead: repair quotes create/update their linked invoice (see recordRepairBilling).
const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer', 'technical_lead']
// Repair staff revise repair invoices via quote revisions in the Repair
// module; those syncs must not be rejected or the invoice goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

// The stored status is a pure document state; payment progress
// ('paid'/'partially_paid') is derived from amount_paid at read time, so
// legacy payment statuses collapse onto the posted state.
const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:         'approved',
  paid:           'approved',
  partially_paid: 'approved',
  overdue:        'approved',
  partial:        'approved',
  pending:        'pending_approval',
  sent:           'pending_approval',
  open:           'approved',
}

const VALID_STATUSES = new Set([
  'draft', 'pending_approval', 'approved', 'rejected', 'invoiced',
  'dispatched', 'delivered', 'cancelled', 'voided',
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
    invoiceAddress: body.invoiceAddress ?? undefined,
    deliveryAddress: body.deliveryAddress ?? undefined,
    paymentBlocked: body.paymentBlocked !== undefined ? Boolean(body.paymentBlocked) : undefined,
    // A number is assigned when the draft is posted; accept it on update.
    invoiceNumber: body.invoiceNumber ?? body.ref ?? undefined,
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
    const body = await request.json()
    const actor = await requireRole(isRepairLinked(body) ? REPAIR_WRITE_ROLES : WRITE_ROLES)
    const lines: any[] | undefined = body.lines ?? body.items ?? undefined
    const clientId = (body.clientId !== undefined || body.partnerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.partnerId, body)
      : undefined

    const before = await prisma.invoice.findUnique({ where: { id: params.id } })

    const data = mapInvoiceUpdateToDb(body, clientId)
    // The official number is assigned when a draft is posted. Once assigned it
    // is immutable — posted invoices can never be renumbered.
    if (data.invoiceNumber !== undefined && before && before.status !== 'draft' && data.invoiceNumber !== before.invoiceNumber) {
      delete data.invoiceNumber
    }

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...data,
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
