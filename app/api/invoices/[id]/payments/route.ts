import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { loadAppState } from '@/lib/server-store'
import {
  canPayOwnPostedInvoice,
  canPostOrPayCustomerInvoice,
  DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES,
} from '@/lib/finance-controls'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

function mapDbStatusToClient(status: string): string {
  if (status === 'approved') return 'posted'
  if (status === 'pending_approval') return 'draft'
  return status
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const invoiceId = params.id
    const body = await request.json()

    const {
      amount,
      paymentMethod = 'cash',
      reference,
      paidAt,
      bankAccountId,
      idempotencyKey,
    } = body

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const clientStatus = mapDbStatusToClient(String(invoice.status))
    if (clientStatus !== 'posted') {
      return NextResponse.json({ error: 'Only posted invoices can receive payments' }, { status: 409 })
    }
    if (invoice.paymentBlocked) {
      return NextResponse.json({ error: 'Payments are blocked on this invoice' }, { status: 409 })
    }

    // Threshold / SoD from system settings + store postedBy mirror
    try {
      const state = await loadAppState(['deed_invoices', 'deed_systemSettings'])
      const invoices = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
      const mirror = invoices.find(i => i.id === invoiceId)
      const settings = (state.deed_systemSettings && typeof state.deed_systemSettings === 'object')
        ? state.deed_systemSettings as Record<string, unknown>
        : {}
      const limit = Number(settings.accAdminOfficerInvoiceLimitKes) || DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES
      // Prisma invoices are customer AR documents; vendor bills live primarily in the store mirror.
      const invoiceType = (mirror?.type === 'vendor_bill') ? 'vendor_bill' : 'customer_invoice'
      const invoiceTotal = Number(invoice.totalAmount)
      const gate = canPostOrPayCustomerInvoice({
        role: actor.role,
        invoiceType,
        invoiceTotal,
        limitKes: limit,
      })
      if (!gate.ok) {
        return NextResponse.json({ error: gate.reason || 'Forbidden' }, { status: 403 })
      }
      const sod = canPayOwnPostedInvoice({
        role: actor.role,
        actorUserId: actor.id,
        postedByUserId: typeof mirror?.postedByUserId === 'string' ? mirror.postedByUserId : null,
        invoiceTotal,
        sodThresholdKes: limit,
      })
      if (!sod.ok) {
        return NextResponse.json({ error: sod.reason || 'Segregation of duties' }, { status: 409 })
      }
    } catch {
      // If store mirror unavailable, still enforce role + posted status above
    }

    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const existing = await prisma.payment.findFirst({
        where: {
          invoiceId,
          isVoided: false,
          OR: [
            { id: idempotencyKey },
            { reference: idempotencyKey },
            { notes: { contains: `idempotency:${idempotencyKey}` } },
          ],
        },
      })
      if (existing) {
        const updatedInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
        return NextResponse.json({ payment: existing, invoice: updatedInvoice, idempotent: true })
      }
    }

    const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid)
    if (balance <= 0) {
      return NextResponse.json({ error: 'Invoice already fully paid' }, { status: 400 })
    }

    const capped = Math.min(Number(amount), balance)
    const newAmountPaid = Number(invoice.amountPaid) + capped

    const notesParts = [
      bankAccountId ? `Account: ${bankAccountId}` : null,
      idempotencyKey ? `idempotency:${idempotencyKey}` : null,
    ].filter(Boolean)
    const notes = notesParts.length ? notesParts.join(' · ') : null

    const [payment, updatedInvoice] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          ...(typeof idempotencyKey === 'string' && /^[0-9a-f-]{36}$/i.test(idempotencyKey)
            ? { id: idempotencyKey }
            : {}),
          invoiceId,
          amount: capped,
          paymentMethod: paymentMethod as any,
          reference: reference || null,
          paidAt: paidAt ? new Date(paidAt) : new Date(),
          notes,
          createdById: actor.id,
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: newAmountPaid },
      }),
    ])

    await writeFinancialAudit({
      userId: actor.id,
      action: 'record_invoice_payment',
      entityType: 'invoice',
      entityId: invoiceId,
      oldValues: { amountPaid: Number(invoice.amountPaid), status: invoice.status },
      newValues: { amountPaid: newAmountPaid, paymentAmount: capped, paymentMethod, idempotencyKey },
    })

    return NextResponse.json({ payment, invoice: updatedInvoice })
  })
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  return withApiErrorHandling(async () => {
    await requireRole([...WRITE_ROLES])
    const payments = await prisma.payment.findMany({
      where: { invoiceId: params.id, isVoided: false },
      orderBy: { paidAt: 'asc' },
    })
    return NextResponse.json(payments)
  })
}
