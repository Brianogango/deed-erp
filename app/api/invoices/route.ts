import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { computeInvoiceTotals, clampAmountPaid, computeInvoiceLineMoney } from '@/lib/finance-invoice'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { getNextDocNumber } from '@/lib/doc-ref-counter'

// technical_lead: repair quotes create/update their linked invoice (see recordRepairBilling).
const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer', 'technical_lead']
// Repair staff trigger repair invoices from the Repair module; those syncs
// must not be rejected or the server copy silently goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

// Map frontend status aliases to valid DocumentStatus enum values. The stored
// status is a pure document state; payment progress ('paid'/'partially_paid')
// is derived from amount_paid at read time, so legacy payment statuses
// collapse onto the posted state.
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
    invoiceAddress: body.invoiceAddress ?? null,
    deliveryAddress: body.deliveryAddress ?? null,
    paymentBlocked: Boolean(body.paymentBlocked),
  }
}

function mapInvoiceItems(lines: any[]) {
  return lines.map((l: any, index: number) => {
    const isSection = l.lineType === 'section' || l.type === 'section'
    if (isSection) {
      return {
        description: String(l.description ?? l.desc ?? '').trim() || 'Section',
        qty: 0,
        unitPrice: 0,
        discountPct: 0,
        taxRate: 0,
        lineSubtotal: 0,
        lineTax: 0,
        lineTotal: 0,
        sortOrder: index,
      }
    }
    const money = computeInvoiceLineMoney({
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      discountPct: l.discountPct ?? l.discount,
      subtotal: l.subtotal,
      lineSubtotal: l.lineSubtotal,
    })
    return {
      description: l.description ?? '',
      qty: money.qty || 1,
      unitPrice: money.unitPrice,
      discountPct: money.discountPct,
      taxRate: money.taxRate,
      lineSubtotal: money.lineSubtotal,
      lineTax: money.lineTax,
      lineTotal: money.lineTotal,
      sortOrder: index,
      ...(optionalUuid(l.productId) ? { productId: optionalUuid(l.productId) } : {}),
    }
  })
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
      invoiceNumber = await getNextDocNumber('invoice')
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
