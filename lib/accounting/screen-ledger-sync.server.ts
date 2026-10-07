import 'server-only'

import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys, withAppStateKeyLock, loadAppStateForWrite } from '@/lib/server-store'
import { isPostingRef } from '@/lib/accounting/duplicate-invoice-journals'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import {
  planMissingDocs,
  planUnbookedPayments,
  type MissingDocPlan,
  type UnbookedPaymentPlan,
} from '@/lib/accounting/screen-ledger-sync'

type Row = Record<string, any>
const list = (v: unknown): Row[] => (Array.isArray(v) ? v as Row[] : [])

export async function findScreenLedgerGaps(): Promise<{ missing: MissingDocPlan[]; payments: UnbookedPaymentPlan[] }> {
  const state = await loadAppState(['deed_invoices'])
  const screen = list(state.deed_invoices)
  const ids = screen.map(r => String(r?.id ?? '')).filter(id => /^[0-9a-f-]{36}$/i.test(id))
  const ledgerRows = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, amountPaid: true,
      payments: { where: { isVoided: false }, select: { id: true } },
      paymentAllocations: { where: { reversedAt: null, payment: { isVoided: false } }, select: { paymentId: true } },
    },
  })
  const ledgerIds = new Set(ledgerRows.map(r => r.id))
  const ledger = new Map(ledgerRows.map(r => [r.id, {
    amountPaid: Number(r.amountPaid),
    paymentIds: new Set([...r.payments.map(p => p.id), ...r.paymentAllocations.map(a => a.paymentId)]),
  }]))
  return {
    missing: planMissingDocs(screen, ledgerIds),
    payments: planUnbookedPayments(screen, ledger),
  }
}

type Result = { ref: string; status: 'fixed' | 'failed' | 'skipped'; message: string }

const bodyError = async (res: Response) => {
  const body = await res.json().catch(() => null) as { error?: string } | null
  return body?.error || `server returned ${res.status}`
}

/**
 * Book the gaps through the normal routes (same checks, same posting rules).
 * Called from a director's request, so the routes see that director's session.
 */
export async function applyScreenLedgerSync(actorId: string): Promise<Result[]> {
  const { POST: createInvoice } = await import('@/app/api/invoices/route')
  const { POST: registerPayment } = await import('@/app/api/invoices/[id]/payments/route')
  const { missing, payments } = await findScreenLedgerGaps()
  const results: Result[] = []

  if (missing.length) {
    const screen = list((await loadAppState(['deed_invoices'])).deed_invoices)
    for (const plan of missing) {
      if (plan.problem) { results.push({ ref: plan.ref, status: 'skipped', message: plan.problem }); continue }
      const row = screen.find(r => String(r.id) === plan.id)
      if (!row) continue
      // A line whose product is not in the ledger's catalogue is booked by its
      // description (the product link would fail the whole document).
      const lines = Array.isArray(row.lines) ? row.lines as Row[] : []
      const productIds = [...new Set(lines.map(l => String(l.productId ?? '')).filter(Boolean))]
      const known = new Set((await prisma.product.findMany({ where: { id: { in: productIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)) } }, select: { id: true } })).map(p => p.id))
      const body = {
        ...row,
        lines: lines.map(l => (l.productId && !known.has(String(l.productId)) ? { ...l, productId: undefined } : l)),
        ref: plan.ref,
        invoiceNumber: plan.ref,
        date: plan.date,
        invoiceDate: plan.date,
        dueDate: plan.dueDate,
        // The paid figure belongs to payments, which are booked separately.
        amountPaid: 0,
      }
      try {
        const res = await createInvoice(new Request('http://internal/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }))
        if (!res.ok) { results.push({ ref: plan.ref, status: 'failed', message: await bodyError(res) }); continue }
        const created = await res.json() as { id: string; invoiceNumber: string }
        // Same id on screen and ledger, and the corrected dates on screen.
        await withAppStateKeyLock('deed_invoices', async () => {
          const st = await loadAppStateForWrite(['deed_invoices'])
          const rows = list(st.deed_invoices).map(r => (String(r.id) === plan.id
            ? { ...r, id: created.id, date: plan.date, dueDate: plan.dueDate }
            : r))
          await saveStoreKeys({ deed_invoices: JSON.stringify(rows) })
        })
        const posting = await prisma.journalEntry.findMany({
          where: { invoiceId: created.id, sourceType: { in: ['invoice', 'bill'] }, isReversed: false, reversalOfId: null },
          select: { ref: true },
        })
        const booked = posting.some(j => isPostingRef(j.ref, created.invoiceNumber))
        results.push({
          ref: plan.ref,
          status: booked ? 'fixed' : 'failed',
          message: booked
            ? `Booked${plan.fixedDates ? ` (date corrected to ${plan.date})` : ''}`
            : 'Document saved but its ledger entry did not post — check the server log',
        })
      } catch (err) {
        results.push({ ref: plan.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not book' })
      }
    }
  }

  for (const plan of payments) {
    if (plan.alignOnly) {
      try {
        const inv = await prisma.invoice.findUnique({ where: { id: plan.invoiceId }, select: { totalAmount: true, amountPaid: true } })
        if (!inv) { results.push({ ref: plan.ref, status: 'failed', message: 'Not in the ledger' }); continue }
        const target = Math.min(plan.screenPaid, Math.abs(Number(inv.totalAmount)))
        await prisma.$transaction(async tx => {
          await tx.invoice.update({ where: { id: plan.invoiceId }, data: { amountPaid: target } })
          await writeFinancialAuditInTx(tx, {
            userId: actorId,
            action: 'align_pre_ledger_amount_paid',
            entityType: 'invoice',
            entityId: plan.invoiceId,
            oldValues: { amountPaid: Number(inv.amountPaid) },
            newValues: { amountPaid: target, reason: 'Paid before the 13 Sep ledger start (opening balances) — no entry posted' },
          })
        })
        results.push({ ref: plan.ref, status: 'fixed', message: `Paid amount aligned to KES ${Math.round(target).toLocaleString('en-KE')} (before the ledger start, no entry)` })
      } catch (err) {
        results.push({ ref: plan.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not align' })
      }
      continue
    }
    if (plan.manual) {
      results.push({ ref: plan.ref, status: 'skipped', message: 'Paid on screen with no payment listed — register it on the document' })
      continue
    }
    for (const p of plan.book) {
      try {
        const res = await registerPayment(new Request(`http://internal/api/invoices/${plan.invoiceId}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: p.amount,
            paymentMethod: p.method,
            reference: p.reference,
            paidAt: p.date || undefined,
            idempotencyKey: p.id,
            silent: true,
          }),
        }), { params: Promise.resolve({ id: plan.invoiceId }) })
        results.push(res.ok
          ? { ref: plan.ref, status: 'fixed', message: `Payment of KES ${Math.round(p.amount).toLocaleString('en-KE')} booked` }
          : { ref: plan.ref, status: 'failed', message: await bodyError(res) })
      } catch (err) {
        results.push({ ref: plan.ref, status: 'failed', message: err instanceof Error ? err.message : 'could not book' })
      }
    }
  }
  return results
}
