import 'server-only'

import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import {
  applyReversalToInvoices,
  reversalBlockedForMethod,
  reversalJournalForStore,
  type PaymentReversalInfo,
} from '@/lib/accounting/payment-reversal'

const round2 = (n: number) => Math.round(n * 100) / 100

function httpError(message: string, status: number) {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

/**
 * Reverse one payment on an invoice (see payment-reversal.ts). Everything on
 * the ledger side happens in one serializable transaction: payment voided,
 * allocations reversed, invoice amounts recomputed, receipt journal reversed,
 * audit written. The screen copies are brought in line afterwards.
 */
export async function reverseInvoicePayment(params: {
  invoiceId: string
  paymentId: string
  reason: string
  actor: { id: string; name: string }
}) {
  const reason = params.reason.trim()
  if (reason.length < 3) throw httpError('Say why the payment is being reversed', 422)

  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    include: { allocations: true },
  })
  const onInvoice = payment && (payment.invoiceId === params.invoiceId || payment.allocations.some(a => a.invoiceId === params.invoiceId))
  if (!payment || !onInvoice) throw httpError('Payment not found on this invoice', 404)
  if (payment.isVoided) throw httpError('This payment was already reversed', 409)
  const blocked = reversalBlockedForMethod(payment.notes)
  if (blocked) throw httpError(blocked, 409)
  if (payment.reconciliationStatus === 'reconciled') {
    throw httpError('This payment is matched to a bank statement line — unmatch it in bank reconciliation first', 409)
  }
  if (payment.journalId) {
    const matched = await prisma.bankReconciliationMatch.findFirst({ where: { journalEntryId: payment.journalId, reversedAt: null }, select: { id: true } })
    if (matched) throw httpError('This payment is matched to a bank statement line — unmatch it in bank reconciliation first', 409)
  }
  const now = new Date()
  const lock = await checkFiscalLock(now)
  if (!lock.ok) throw httpError(lock.error, lock.status)

  const result = await prisma.$transaction(async tx => {
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: true } })
    if (fresh.isVoided) throw httpError('This payment was already reversed', 409)
    await tx.payment.update({
      where: { id: fresh.id },
      data: { isVoided: true, voidedAt: now, voidedById: params.actor.id, voidReason: reason.slice(0, 500) },
    })
    await tx.paymentAllocation.updateMany({ where: { paymentId: fresh.id, reversedAt: null }, data: { reversedAt: now } })

    const invoiceIds = [...new Set([...fresh.allocations.map(a => a.invoiceId), ...(fresh.invoiceId ? [fresh.invoiceId] : [])])]
    const amountPaidByInvoice: Record<string, number> = {}
    for (const invoiceId of invoiceIds) {
      const live = await tx.paymentAllocation.findMany({
        where: { invoiceId, reversedAt: null, payment: { isVoided: false } },
        select: { amount: true },
      })
      const paid = round2(live.reduce((s, a) => s + Number(a.amount), 0))
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } })
      if (!inv) continue
      await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid } })
      amountPaidByInvoice[invoiceId] = paid
    }

    let journal: { originalRef: string; revRef: string } | null = null
    if (fresh.journalId) {
      const original = await tx.journalEntry.findUnique({ where: { id: fresh.journalId }, include: { lines: true, journal: { select: { code: true } } } })
      if (original && !original.isReversed) {
        const revRef = `REV/${original.ref}`.slice(0, 80)
        const reversal = await createJournalEntryInTx(tx, {
          ref: revRef,
          journalCode: original.journal?.code ?? undefined,
          date: now,
          description: `Payment reversed — ${reason} (reversal of ${original.ref})`.slice(0, 500),
          sourceType: 'payment_reversal',
          sourceId: fresh.id,
          invoiceId: original.invoiceId,
          paymentId: fresh.id,
          createdById: params.actor.id,
          skipIfExists: true,
          lines: original.lines.map(l => ({
            accountLabel: l.accountLabel,
            label: `Reversal: ${l.label ?? ''}`,
            debit: Number(l.credit),
            credit: Number(l.debit),
            partnerId: l.partnerId,
            analyticAccountId: l.analyticAccountId,
          })),
        })
        await tx.journalEntry.update({ where: { id: original.id }, data: { isReversed: true } })
        await tx.journalEntry.update({ where: { id: reversal.id }, data: { reversalOfId: original.id } })
        journal = { originalRef: original.ref, revRef }
      } else if (original) {
        journal = { originalRef: original.ref, revRef: `REV/${original.ref}`.slice(0, 80) }
      }
    }

    await writeFinancialAuditInTx(tx, {
      userId: params.actor.id,
      action: 'reverse_invoice_payment',
      entityType: 'payment',
      entityId: fresh.id,
      oldValues: { amount: Number(fresh.amount), invoiceIds, isVoided: false },
      newValues: { isVoided: true, reason, amountPaidByInvoice, reversalJournal: journal?.revRef ?? null },
    })
    return { amount: Number(fresh.amount), amountPaidByInvoice, journal }
  }, { isolationLevel: 'Serializable' })

  // Screen copies: the invoice owes the money again; the cashbook stops counting it.
  const info: PaymentReversalInfo = {
    paymentId: payment.id,
    amount: result.amount,
    reason,
    reversedAt: now.toISOString(),
    reversedBy: params.actor.name,
    method: String(payment.paymentMethod),
    paidAt: payment.paidAt.toISOString(),
  }
  try {
    await withAppStateKeyLock('deed_invoices', async () => {
      const state = await loadAppStateForWrite(['deed_invoices', 'deed_journalEntries'])
      const invoices = Array.isArray(state.deed_invoices) ? state.deed_invoices as Array<Record<string, unknown>> : []
      const journals = Array.isArray(state.deed_journalEntries) ? state.deed_journalEntries as Array<Record<string, unknown>> : []
      const updates: Record<string, string> = {
        deed_invoices: JSON.stringify(applyReversalToInvoices(invoices, info, result.amountPaidByInvoice)),
      }
      if (result.journal) {
        const rev = reversalJournalForStore(journals, result.journal.originalRef, result.journal.revRef, reason, info.reversedAt)
        if (rev) updates.deed_journalEntries = JSON.stringify([rev, ...journals])
      }
      await saveStoreKeys(updates)
    })
  } catch (err) {
    console.error('[payment-reversal] screen copy update failed:', err)
  }

  return { ...info, amountPaidByInvoice: result.amountPaidByInvoice, reversalJournalRef: result.journal?.revRef ?? null }
}
