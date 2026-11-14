/**
 * POST — credit note on a posted customer invoice: part of the work was not
 * done, or we overcharged. Reverses that part of the sale and its VAT. Any
 * part the customer already paid becomes their credit balance, to refund or
 * use on a later invoice.
 *
 * Body: { reason, lines?: [{ invoiceItemId, amount }], amount? } — an amount
 * per line (VAT included), or one amount spread over the lines.
 *
 * GET — the invoice's lines with what is still open to credit, for the form.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { createCustomerCreditNote, creditLinesForAmount } from '@/lib/accounting/credit-note-service'
import { addCustomerCreditBalance } from '@/lib/accounting/customer-credit-balance.server'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export async function POST(request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('invoices.credit_note')
    const { id } = await resolveRouteParams(params)
    const body = await request.json().catch(() => null) as {
      reason?: string
      amount?: number
      lines?: Array<{ invoiceItemId?: string; amount?: number }>
    } | null

    const reason = String(body?.reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'Say why the credit is given' }, { status: 400 })

    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true, client: true } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (invoiceDocumentType(invoice) === 'vendor_bill') return NextResponse.json({ error: 'Use a supplier credit for bills' }, { status: 409 })
    if (invoice.isDownPayment) return NextResponse.json({ error: 'Credit the final invoice, not the down-payment invoice' }, { status: 409 })

    const lock = await checkFiscalLock(new Date())
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: lock.status })

    const byId = new Map(invoice.items.map(i => [i.id, i]))
    const picked = (Array.isArray(body?.lines) ? body!.lines : []).flatMap(l => {
      const item = byId.get(String(l.invoiceItemId || ''))
      const amount = Number(l.amount)
      if (!item || !(amount > 0) || !(Number(item.lineTotal) > 0)) return []
      return [{ invoiceItemId: item.id, qty: Number(item.qty) * Math.min(1, amount / Number(item.lineTotal)) }]
    })
    const lines = picked.length ? picked
      : Number(body?.amount) > 0 ? creditLinesForAmount(invoice.items, Number(body!.amount)) : null
    if (!lines?.length) {
      return NextResponse.json({ error: Number(body?.amount) > 0 ? 'The credit is more than the invoice lines' : 'Pick the lines or enter the amount to credit' }, { status: 400 })
    }

    const ref = await getNextDocNumber('credit_note')
    const result = await createCustomerCreditNote({ invoiceId: invoice.id, creditNoteNumber: ref, lines, reason, actorId: actor.id })
    await addCustomerCreditBalance({
      ref: result.ref,
      customerId: invoice.clientId,
      customerName: invoice.client?.name ?? '',
      sourceInvoiceId: invoice.id,
      sourceInvoiceRef: invoice.invoiceNumber,
      amount: result.customerCredit,
      createdBy: actor.name || actor.username || 'Finance',
      notes: `${reason}. Already paid to us — refund it or keep it as credit.`,
    })
    await notifyStoreKeysChanged(['deed_invoices']).catch(() => {})
    return NextResponse.json({ ok: true, creditNote: result })
  })
}

export async function GET(_request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requirePermission('invoices.credit_note')
    const { id } = await resolveRouteParams(params)
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    const credited = await prisma.creditNoteLine.groupBy({
      by: ['originalInvoiceItemId'],
      where: { originalInvoiceItemId: { in: invoice.items.map(i => i.id) } },
      _sum: { lineTotal: true },
    })
    const done = new Map(credited.map(c => [c.originalInvoiceItemId, Number(c._sum?.lineTotal || 0)]))
    const lines = invoice.items.map(i => ({
      id: i.id,
      description: i.description,
      lineTotal: Number(i.lineTotal),
      credited: done.get(i.id) ?? 0,
      open: Math.max(0, Math.round((Number(i.lineTotal) - (done.get(i.id) ?? 0)) * 100) / 100),
    }))
    const paid = Number(invoice.amountPaid)
    return NextResponse.json({ lines, total: Number(invoice.totalAmount), amountPaid: paid })
  })
}
