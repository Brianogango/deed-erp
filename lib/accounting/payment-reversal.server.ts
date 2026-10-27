import 'server-only'

import prisma from '@/lib/prisma'
import { createJournalEntryInTx } from '@/lib/accounting/journal-service'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import {
  applyReversalToInvoices,
  restoreCustomerCredits,
  reversalBlockedForMethod,
  reversalJournalForStore,
  type PaymentReversalInfo,
} from '@/lib/accounting/payment-reversal'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * amountPaid after taking a reversed payment off. A credit note carries a
 * negative total and records what was used or refunded as a negative
 * amountPaid, so its figure moves back up towards 0, never past it.
 */
export function restoredAmountPaid(totalAmount: number, amountPaid: number, removed: number): number {
  return totalAmount < 0
    ? round2(Math.min(0, amountPaid + removed))
    : round2(Math.max(0, amountPaid - removed))
}

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
  // A deposit applied by the server (deposit_applications row): reversed
  // here, and the deposit gets the amount back. Only older browser-made
  // records with no such row stay refused.
  const depositUses = await prisma.depositApplication.findMany({ where: { paymentId: payment.id, status: 'applied' }, select: { id: true } })
  const blocked = depositUses.length && /method:deposit_apply\b/.test(String(payment.notes ?? '')) ? null : reversalBlockedForMethod(payment.notes)
  if (blocked) throw httpError(blocked, 409)
  if (payment.reconciliationStatus === 'reconciled') {
    throw httpError('This payment is matched to a bank statement line — unmatch it in bank reconciliation first', 409)
  }
  if (payment.journalId) {
    const matched = await prisma.bankReconciliationMatch.findFirst({ where: { journalEntryId: payment.journalId, reversedAt: null }, select: { id: true } })
    if (matched) throw httpError('This payment is matched to a bank statement line — unmatch it in bank reconciliation first', 409)
  }
  const isVendorCreditUse = /method:vendor_credit\b/.test(String(payment.notes ?? ''))
  // A customer credit applied to an invoice: its balance must come back. The
  // credits live in the store, so check before touching the ledger that the
  // applications this payment made can be found.
  const isCustomerCreditUse = /method:customer_credit\b/.test(String(payment.notes ?? ''))
  const creditRefs = String(payment.externalReference || payment.reference || '').split(',').map(r => r.trim()).filter(Boolean)
  if (isCustomerCreditUse) {
    const { deed_customerCredits } = await loadAppStateForWrite(['deed_customerCredits'])
    const credits = Array.isArray(deed_customerCredits) ? deed_customerCredits as Array<Record<string, unknown>> : []
    const check = restoreCustomerCredits(credits, { invoiceId: params.invoiceId, refs: creditRefs, amount: Number(payment.amount), reason, at: new Date().toISOString(), by: params.actor.name })
    if (check.restored < Number(payment.amount) - 0.005) {
      throw httpError(`Could not find where ${creditRefs.join(', ') || 'the customer credit'} was used on this invoice — nothing was reversed`, 409)
    }
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
      // Take off what this payment put on the invoice — not a recount of the
      // payment records, which miss payments made before they existed
      // (migrated / older invoices) and would undercount what was paid.
      const removed = fresh.allocations.filter(a => a.invoiceId === invoiceId).reduce((s, a) => s + Number(a.amount), 0)
        || (fresh.allocations.length === 0 && fresh.invoiceId === invoiceId ? Number(fresh.amount) : 0)
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, amountPaid: true, totalAmount: true } })
      if (!inv) continue
      const paid = restoredAmountPaid(Number(inv.totalAmount), Number(inv.amountPaid), removed)
      await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid } })
      amountPaidByInvoice[invoiceId] = paid
    }

    // A supplier credit applied to a bill: the amount goes back onto the
    // credit note (open to use again or to be refunded).
    if (isVendorCreditUse) {
      const creditRef = String(fresh.externalReference || fresh.reference || '').trim()
      const credit = creditRef
        ? await tx.invoice.findFirst({
          where: { invoiceNumber: creditRef, clientId: fresh.partnerId ?? undefined, totalAmount: { lt: 0 } },
          select: { id: true, amountPaid: true, totalAmount: true, notes: true },
        })
        : null
      if (!credit) throw httpError(`Credit note ${creditRef || '(unknown)'} not found — cannot give the amount back to it`, 409)
      const paid = restoredAmountPaid(Number(credit.totalAmount), Number(credit.amountPaid), Number(fresh.amount))
      await tx.invoice.update({
        where: { id: credit.id },
        data: {
          amountPaid: paid,
          notes: [credit.notes, `Use reversed (${Number(fresh.amount).toLocaleString('en-KE')}): ${reason}`].filter(Boolean).join('\n').slice(0, 5000),
        },
      })
      amountPaidByInvoice[credit.id] = paid
    }

    // A customer deposit applied to the invoice: the use is reversed (the
    // reversed journal below puts the liability back) and the deposit is
    // open again — to apply to the right invoice or to refund.
    const reopenedDeposits: string[] = []
    const uses = await tx.depositApplication.findMany({ where: { paymentId: fresh.id, status: 'applied' } })
    for (const use of uses) {
      await tx.depositApplication.update({ where: { id: use.id }, data: { status: 'reversed' } })
      const deposit = await tx.deposit.findUnique({ where: { id: use.depositId }, select: { id: true, status: true, balance: true } })
      if (deposit?.status === 'completed') {
        await tx.deposit.update({
          where: { id: deposit.id },
          data: { status: Number(deposit.balance) <= 0 ? 'fully_paid' : 'partially_paid', completedAt: null },
        })
      }
      if (deposit) reopenedDeposits.push(deposit.id)
    }

    let journal: { originalRef: string; revRef: string } | null = null
    // Applying a credit posted nothing of its own: its journalId is the credit
    // note's journal. Reversing that would undo the whole credit note.
    if (fresh.journalId && !isVendorCreditUse) {
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
    return { amount: Number(fresh.amount), amountPaidByInvoice, journal, reopenedDeposits }
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
  if (result.reopenedDeposits.length) {
    await notifyStoreKeysChanged(['deed_deposits']).catch(() => null)
  }

  if (isCustomerCreditUse) {
    try {
      await withAppStateKeyLock('deed_customerCredits', async () => {
        const state = await loadAppStateForWrite(['deed_customerCredits'])
        const credits = Array.isArray(state.deed_customerCredits) ? state.deed_customerCredits as Array<Record<string, unknown>> : []
        const { credits: next } = restoreCustomerCredits(credits, {
          invoiceId: params.invoiceId, refs: creditRefs, amount: result.amount, reason, at: now.toISOString(), by: params.actor.name,
        })
        await saveStoreKeys({ deed_customerCredits: JSON.stringify(next) })
      })
    } catch (err) {
      console.error('[payment-reversal] customer credit balance update failed:', err)
    }
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
        const docNumbers = invoices.filter(i => String(i.id) in result.amountPaidByInvoice).map(i => String(i.ref ?? ''))
        const candidates = [result.journal.originalRef, ...docNumbers.map(ref => `JRN/PAY/${ref}/${payment.id}`)]
        const rev = reversalJournalForStore(journals, candidates, result.journal.revRef, reason, info.reversedAt)
        if (rev) updates.deed_journalEntries = JSON.stringify([rev, ...journals])
      }
      await saveStoreKeys(updates)
    })
  } catch (err) {
    console.error('[payment-reversal] screen copy update failed:', err)
  }

  return { ...info, amountPaidByInvoice: result.amountPaidByInvoice, reversalJournalRef: result.journal?.revRef ?? null }
}
