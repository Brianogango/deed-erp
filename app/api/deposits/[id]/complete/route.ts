import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { readDeposits, writeDeposits } from '@/lib/deposit-store'
import { loadAppState } from '@/lib/server-store'
import { postDepositClearJournalToPrisma } from '@/lib/accounting/invoice-journals'

export const dynamic = 'force-dynamic'

export async function POST(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])

    const deposits = await readDeposits()
    const idx = deposits.findIndex(d => d.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const deposit = deposits[idx]

    if (deposit.status !== 'fully_paid') {
      return NextResponse.json({ error: 'Only fully paid deposits can be marked as collected' }, { status: 422 })
    }

    // Find linked quotation/SO and any open posted invoice to clear AR against.
    let invoiceId: string | undefined
    let invoiceRef: string | undefined
    try {
      const state = await loadAppState(['deed_saleOrders', 'deed_invoices'])
      const sos = Array.isArray(state.deed_saleOrders) ? state.deed_saleOrders as Array<Record<string, unknown>> : []
      const invoices = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
      const linkedSo = sos.find(s => String(s.notes || '').includes(String(deposit.ref)))
      if (linkedSo) {
        const linkedInv = invoices.find(i =>
          i.type === 'customer_invoice'
          && i.status === 'posted'
          && i.saleOrderId === linkedSo.id
          && (Number(i.total) - Number(i.amountPaid || 0)) > 0)
        if (linkedInv) {
          invoiceId = String(linkedInv.id)
          invoiceRef = String(linkedInv.ref || '')
        }
      }
    } catch {
      /* best-effort link */
    }

    if (Number(deposit.totalPaid) > 0) {
      try {
        await postDepositClearJournalToPrisma({
          depositRef: String(deposit.ref),
          depositId: String(deposit.id),
          amount: Number(deposit.totalPaid),
          partnerName: String(deposit.customerName || 'Customer'),
          invoiceId,
          invoiceRef,
          createdById: actor.id,
        })
      } catch (err) {
        console.error('[deposit-complete] clear journal failed:', err)
      }
    }

    deposits[idx] = {
      ...deposit,
      status: 'completed',
      completedAt: new Date().toISOString(),
    }

    await writeDeposits(deposits)
    return NextResponse.json(deposits[idx])
  })
}
