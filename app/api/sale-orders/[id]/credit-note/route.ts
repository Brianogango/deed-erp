import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { createCustomerCreditNote } from '@/lib/accounting/credit-note-service'

const WRITE_ROLES = ['director', 'finance_officer']

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const body = await request.json().catch(() => null) as {
      invoiceId?: string
      reason?: string
      creditNoteNumber?: string
      lines?: Array<{ invoiceItemId?: string; qty?: number; returnToStock?: boolean }>
      amount?: number
    } | null

    if (!body?.invoiceId) return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    const reason = String(body.reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'Credit-note reason is required' }, { status: 400 })

    const order = await prisma.saleOrder.findUnique({ where: { id: params.id } })
    if (!order) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })
    if (normalizeSaleStatus(order.status) === 'cancelled') {
      return NextResponse.json({ error: 'Cannot credit a cancelled sale order' }, { status: 409 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: body.invoiceId },
      include: { items: true },
    })
    if (!invoice || invoice.saleOrderId !== params.id) {
      return NextResponse.json({ error: 'Invoice not found on this sale order' }, { status: 404 })
    }
    if (invoice.isDownPayment) {
      return NextResponse.json({ error: 'Credit a down-payment invoice from Finance directly' }, { status: 409 })
    }

    let lines = Array.isArray(body.lines)
      ? body.lines.map(l => ({
          invoiceItemId: String(l.invoiceItemId || ''),
          qty: Number(l.qty),
          returnToStock: Boolean(l.returnToStock),
        }))
      : []

    // Compatibility for the old amount-only UI: convert the amount into a
    // proportional line credit, but still persist a real line-level document.
    if (!lines.length && Number(body.amount) > 0) {
      let remaining = Math.round(Number(body.amount) * 100) / 100
      for (const item of invoice.items) {
        if (remaining <= 0.009) break
        const lineTotal = Number(item.lineTotal)
        if (lineTotal <= 0) continue
        const take = Math.min(remaining, lineTotal)
        const ratio = take / lineTotal
        lines.push({ invoiceItemId: item.id, qty: Number(item.qty) * ratio, returnToStock: false })
        remaining = Math.round((remaining - take) * 100) / 100
      }
      if (remaining > 0.009) {
        return NextResponse.json({ error: 'Credit amount exceeds eligible invoice lines' }, { status: 409 })
      }
    }
    if (!lines.length || lines.some(l => !l.invoiceItemId || !Number.isFinite(l.qty) || l.qty <= 0)) {
      return NextResponse.json({ error: 'Credit note requires valid invoice line quantities' }, { status: 400 })
    }

    const ref = body.creditNoteNumber
      || await getNextDocNumber('credit_note').catch(() => `CN/${Date.now().toString().slice(-6)}`)

    const result = await createCustomerCreditNote({
      invoiceId: invoice.id,
      creditNoteNumber: ref,
      lines,
      reason,
      actorId: actor.id,
    })

    return NextResponse.json({ ok: true, creditNote: result })
  })
}
