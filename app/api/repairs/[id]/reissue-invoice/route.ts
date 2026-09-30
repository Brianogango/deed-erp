import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { createCustomerCreditNote } from '@/lib/accounting/credit-note-service'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { refreshInvoicesBlob, refreshSaleOrdersBlob } from '@/lib/documents-broadcast.server'
import { calcSaleOrderTotalsFromPersistedLines } from '@/lib/sales/line-calc'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { isUUID } from '@/lib/utils'
import {
  INVOICE_REISSUE_ROLES,
  approvedQuoteOrderItems,
  fullCreditLines,
  invoiceReachedLedger,
  reissueCredited,
  type InvoiceReissue,
} from '@/lib/repair/invoice-reissue'

export const dynamic = 'force-dynamic'

/**
 * POST /api/repairs/[id]/reissue-invoice
 *
 * Finance's one step after a client approves a revised quote on a job whose
 * invoice is already posted (lib/repair/invoice-reissue.ts):
 *   1. credit the old invoice in full — anything paid becomes client credit;
 *   2. put the approved quote on the sale order, confirmed;
 *   3. free the repair to be billed afresh the usual way, where the client's
 *      credit is applied to the new invoice.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(INVOICE_REISSUE_ROLES)

    const state = await loadAppState(['deed_repairs_v2'])
    const repairs = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as any[] : []
    const repair = repairs.find(r => r?.id === id)
    if (!repair) return NextResponse.json({ error: 'Repair not found' }, { status: 404 })
    const reissue = repair.invoiceReissue as InvoiceReissue | undefined
    if (reissue?.status !== 'pending') {
      return NextResponse.json({ error: 'This repair has no approved revision waiting for an invoice reissue' }, { status: 409 })
    }
    if (!repair.quote?.approvedDate) {
      return NextResponse.json({ error: 'The revised quote has not been approved yet' }, { status: 409 })
    }

    const invoice = isUUID(reissue.invoiceId)
      ? await prisma.invoice.findUnique({ where: { id: reissue.invoiceId }, include: { items: true, client: true } })
      : null
    if (!invoice) return NextResponse.json({ error: `Invoice ${reissue.invoiceRef} was not found` }, { status: 404 })

    // 1. Take the old invoice off the books.
    let credit: { ref: string; customerCredit: number } = { ref: '', customerCredit: 0 }
    if (invoiceReachedLedger(invoice)) {
      const prior = await prisma.creditNoteLine.groupBy({
        by: ['originalInvoiceItemId'],
        where: { originalInvoiceItemId: { in: invoice.items.map(i => i.id) } },
        _sum: { qty: true },
      })
      const credited = Object.fromEntries(prior.map(p => [p.originalInvoiceItemId, Number(p._sum?.qty ?? 0)]))
      const lines = fullCreditLines(invoice.items, credited)
      if (lines.length) {
        const ref = await getNextDocNumber('credit_note')
        const result = await createCustomerCreditNote({
          invoiceId: invoice.id,
          creditNoteNumber: ref,
          lines,
          reason: `Repair ${repair.ref} re-quoted and approved by the client — replaced by a new invoice`,
          actorId: actor.id,
        })
        credit = { ref: result.ref, customerCredit: result.customerCredit }
      }
    } else if (Number(invoice.amountPaid) > 0) {
      return NextResponse.json({ error: `${reissue.invoiceRef} has payments but never reached the ledger — Finance must review it by hand` }, { status: 409 })
    } else {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'cancelled' } })
    }

    // 2. The sale order carries the approved quote.
    const saleOrderId = [repair.linkedSaleOrderId, repair.saleOrderId, invoice.saleOrderId].find(v => isUUID(v))
    if (saleOrderId) {
      const productIds = new Set((await prisma.product.findMany({
        where: { id: { in: (repair.quote.lines ?? []).map((l: any) => l.productId).filter((v: unknown) => isUUID(v)) } },
        select: { id: true },
      })).map(p => p.id))
      const items = approvedQuoteOrderItems(repair.quote, pid => productIds.has(pid))
      const totals = calcSaleOrderTotalsFromPersistedLines(items as any, 0)
      await prisma.saleOrder.update({
        where: { id: saleOrderId },
        data: {
          status: 'sale',
          locked: false,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discountAmount: 0,
          totalAmount: totals.totalAmount,
          items: { deleteMany: {}, create: items },
        },
      })
    }

    // 3. Free the repair to be billed afresh, and record the client's credit
    //    where Finance's "apply customer credit" finds it.
    const now = new Date().toISOString()
    const actorName = (actor as any).name ?? 'Finance'
    const nextReissue = reissueCredited(reissue, credit, actorName, now)
    await withAppStateKeyLock('deed_repairs_v2', async () => {
      const fresh = await loadAppStateForWrite(['deed_repairs_v2'])
      const list = Array.isArray(fresh.deed_repairs_v2) ? fresh.deed_repairs_v2 as any[] : []
      const idx = list.findIndex(r => r?.id === id)
      if (idx < 0) return
      const current = list[idx]
      list[idx] = {
        ...current,
        invoiceReissue: nextReissue,
        previousInvoiceIds: [...(current.previousInvoiceIds ?? []), invoice.id],
        invoiceId: undefined,
        linkedInvoiceId: undefined,
        linkedInvoiceRef: undefined,
        invoiceDate: undefined,
      }
      await saveStoreKeys({ deed_repairs_v2: JSON.stringify(list) })
    })

    if (credit.customerCredit > 0) {
      await withAppStateKeyLock('deed_customerCredits', async () => {
        const fresh = await loadAppStateForWrite(['deed_customerCredits'])
        const list = Array.isArray(fresh.deed_customerCredits) ? fresh.deed_customerCredits as any[] : []
        list.unshift({
          id: crypto.randomUUID(),
          ref: credit.ref,
          customerId: invoice.clientId,
          customerName: invoice.client?.name ?? repair.customerName ?? '',
          sourceType: 'invoice',
          sourceInvoiceId: invoice.id,
          sourceInvoiceRef: invoice.invoiceNumber,
          amount: credit.customerCredit,
          balance: credit.customerCredit,
          status: 'available',
          createdAt: now,
          createdBy: actorName,
        })
        await saveStoreKeys({ deed_customerCredits: JSON.stringify(list) })
      })
    }

    await writeFinancialAudit({
      userId: actor.id,
      action: 'repair_invoice_reissue',
      entityType: 'Invoice',
      entityId: invoice.id,
      oldValues: { invoiceNumber: invoice.invoiceNumber, totalAmount: Number(invoice.totalAmount) },
      newValues: { repairRef: repair.ref, creditNote: credit.ref || 'cancelled (never posted)', customerCredit: credit.customerCredit, revisedTotal: reissue.revisedTotal },
    }).catch(() => {})
    await Promise.all([refreshInvoicesBlob(), refreshSaleOrdersBlob()])

    return NextResponse.json({ ok: true, reissue: nextReissue })
  })
}
