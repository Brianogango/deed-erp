import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { computeInvoiceTotals, clampAmountPaid } from '@/lib/finance-invoice'
import { writeFinancialAudit } from '@/lib/finance-audit'

// technical_lead: repair quotes create/update their linked invoice (see recordRepairBilling).
const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer', 'technical_lead']
// Repair staff trigger repair invoices from the Repair module; those syncs
// must not be rejected or the server copy silently goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

// Map frontend status aliases to valid DocumentStatus enum values
const INVOICE_STATUS_MAP: Record<string, string> = {
  posted:        'approved',
  partial:       'partially_paid',
  pending:       'pending_approval',
  sent:          'pending_approval',
  open:          'approved',
}

function mapInvoiceBodyToDb(body: any, clientId: string) {
  const rawStatus = body.status ?? 'draft'
  const status = INVOICE_STATUS_MAP[rawStatus] ?? rawStatus

  // Date handling: accept date/invoiceDate aliases
  let invoiceDate: Date | undefined
  if (body.invoiceDate) invoiceDate = new Date(body.invoiceDate)
  else if (body.date) invoiceDate = new Date(body.date)

  // Totals are recomputed from line items server-side; client-supplied
  // subtotal/total are ignored so a tampered payload cannot post an invoice
  // whose header does not tie back to qty × unitPrice.
  const lines: any[] = body.lines ?? body.items ?? []
  const totals = computeInvoiceTotals(lines, {
    headerTax: body.taxAmount ?? body.taxTotal,
    discount: body.discountAmount,
  })

  return {
    invoiceNumber: body.invoiceNumber ?? body.ref,
    clientId,
    saleOrderId: optionalUuid(body.saleOrderId) ?? null,
    repairId: optionalUuid(body.repairId) ?? null,
    quoteId: optionalUuid(body.quoteId) ?? null,
    status,
    invoiceDate,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    subject: body.subject ?? null,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    discountAmount: totals.discountAmount,
    totalAmount: totals.totalAmount,
    amountPaid: clampAmountPaid(body.amountPaid, totals.totalAmount),
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
    ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
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
    const body = await request.json()
    const allowedRoles = isRepairLinked(body) ? REPAIR_WRITE_ROLES : WRITE_ROLES
    const actor = await requireRole(allowedRoles)
    const lines: any[] = body.lines ?? body.items ?? []

    const items = mapInvoiceItems(lines)
    const declaredTotal = Number(body.totalAmount ?? body.total ?? 0)
    const effectiveTotal = declaredTotal || items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
    if (effectiveTotal < 1) {
      return NextResponse.json({ error: 'Invoice total must be at least 1 — invoices below this amount cannot be created' }, { status: 400 })
    }

    const clientId = await resolveClientId(prisma, body.clientId ?? body.partnerId, body)

    let invoiceNumber = body.invoiceNumber ?? body.ref
    if (!invoiceNumber) {
      const count = await prisma.invoice.count()
      invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`
    }

    const invoice = await prisma.invoice.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        ...mapInvoiceBodyToDb(body, clientId),
        invoiceNumber,
        createdById: actor.id,
        items: { create: items },
      } as any,
      include: { items: true },
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'create_invoice',
      entityType: 'invoice',
      entityId: invoice.id,
      newValues: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount, status: invoice.status },
    })

    return NextResponse.json(invoice, { status: 201 })
  })
}
