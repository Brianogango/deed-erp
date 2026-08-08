import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'

const WRITE_ROLES = ['director', 'finance_officer']

/**
 * POST /api/sale-orders/:id/credit-note
 * Durable Prisma CreditNote against a posted invoice for this Sale Order.
 * Complements the client CustomerCredit blob used by After-Sales RMA.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const orderId = params.id
    const body = await request.json().catch(() => null) as {
      invoiceId?: string
      amount?: number
      reason?: string
      creditNoteNumber?: string
    } | null

    const amount = Math.round(Number(body?.amount) || 0)
    if (amount < 1) {
      return NextResponse.json({ error: 'Credit amount must be at least KES 1' }, { status: 400 })
    }
    if (!body?.invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    }

    const order = await prisma.saleOrder.findUnique({ where: { id: orderId } })
    if (!order) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })
    if (normalizeSaleStatus(order.status) === 'cancelled') {
      return NextResponse.json({ error: 'Cannot credit a cancelled sale order' }, { status: 409 })
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: body.invoiceId } })
    if (!invoice || invoice.saleOrderId !== orderId) {
      return NextResponse.json({ error: 'Invoice not found on this sale order' }, { status: 404 })
    }
    if (String(invoice.status) === 'cancelled' || String(invoice.status) === 'draft') {
      return NextResponse.json({ error: 'Credit notes require a posted invoice' }, { status: 409 })
    }
    if (invoice.isDownPayment) {
      return NextResponse.json({ error: 'Credit a down-payment invoice from Finance directly' }, { status: 409 })
    }

    const ref = body.creditNoteNumber
      || await getNextDocNumber('credit_note').catch(() => `CN/${Date.now().toString().slice(-6)}`)

    const creditNote = await prisma.creditNote.create({
      data: {
        creditNoteNumber: ref,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        amount,
        reason: String(body.reason || `Credit note for ${order.orderNumber}`).slice(0, 500),
        status: 'open',
        createdById: actor.id,
      },
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'create_credit_note_from_so',
      entityType: 'credit_note',
      entityId: creditNote.id,
      newValues: {
        saleOrderId: orderId,
        invoiceId: invoice.id,
        ref: creditNote.creditNoteNumber,
        amount,
      },
    })

    return NextResponse.json({
      ok: true,
      creditNote: {
        id: creditNote.id,
        ref: creditNote.creditNoteNumber,
        amount: Number(creditNote.amount),
        invoiceId: invoice.id,
        status: creditNote.status,
      },
    })
  })
}
