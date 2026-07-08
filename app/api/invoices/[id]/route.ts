import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']
// Repair staff revise repair invoices via quote revisions in the Repair
// module; those syncs must not be rejected or the invoice goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technical_lead', 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

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

  const data: Record<string, any> = {
    clientId,
    saleOrderId: body.saleOrderId !== undefined ? optionalUuid(body.saleOrderId) ?? null : undefined,
    repairId: body.repairId !== undefined ? optionalUuid(body.repairId) ?? null : undefined,
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
    await requireRole(isRepairLinked(body) ? REPAIR_WRITE_ROLES : WRITE_ROLES)
    const lines: any[] | undefined = body.lines ?? body.items ?? undefined
    const clientId = (body.clientId !== undefined || body.partnerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.partnerId, body)
      : undefined

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
    return NextResponse.json(invoice)
  })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    // Delete items first (no cascade in schema), then the invoice.
    const itemDelete = (prisma as any).invoiceItem?.deleteMany?.({ where: { invoiceId: params.id } })
    const invoiceDelete = prisma.invoice.delete({ where: { id: params.id } })
    if (itemDelete && typeof (prisma as any).$transaction === 'function') {
      await (prisma as any).$transaction([itemDelete, invoiceDelete])
    } else {
      if (itemDelete) await itemDelete
      await invoiceDelete
    }
    return NextResponse.json({ ok: true })
  })
}
