import 'server-only'

import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { cashLabelForBankAccount } from '@/lib/accounting/bank-cash-account.server'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { isUuid } from '@/lib/legacy-compat'
import { loadAppState, loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { bankAccountLabel, effectivePaymentBankId, moneyMoved, reconciledStatementLine } from '@/lib/finance/payment-bank'

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status })
}

type Row = Record<string, any>

/**
 * Move a payment to the bank or cash account it really went through. The
 * books get one transfer between the two accounts (money in: Dr new / Cr
 * old; money out: Dr old / Cr new); the payment records the new account and
 * the change; the cashbook follows the payment. Refused once the payment is
 * matched to a bank statement line: the statement depends on it.
 */
export async function changePaymentBank(params: {
  invoiceId: string
  paymentId: string
  bankAccountId: string
  reason: string
  actor: { id: string; name: string }
}) {
  const reason = params.reason.trim()
  if (reason.length < 3) throw httpError('Say why the bank is changed', 422)
  const now = new Date()
  const lock = await checkFiscalLock(now)
  if (!lock.ok) throw httpError(lock.error ?? 'That period is closed', lock.status ?? 409)

  const ctx = await loadAppState(['deed_bankAccounts', 'deed_bankStatementLines'])
  const banks = (Array.isArray(ctx.deed_bankAccounts) ? ctx.deed_bankAccounts : []) as Row[]
  const target = banks.find(b => b.id === params.bankAccountId)
  if (!target || target.active === false) throw httpError('Pick an active bank or cash account', 422)
  const statementLines = (Array.isArray(ctx.deed_bankStatementLines) ? ctx.deed_bankStatementLines : []) as Row[]
  if (reconciledStatementLine(statementLines, params.invoiceId, params.paymentId)) {
    throw httpError('This payment is matched to a bank statement line — unmatch it in bank reconciliation first', 409)
  }
  const prismaPayment = isUuid(params.paymentId)
    ? await prisma.payment.findUnique({ where: { id: params.paymentId }, select: { id: true, isVoided: true, journalId: true, reconciliationStatus: true } })
    : null
  if (prismaPayment?.isVoided) throw httpError('This payment was reversed', 409)
  if (prismaPayment?.reconciliationStatus === 'reconciled') throw httpError('This payment is reconciled — unmatch it in bank reconciliation first', 409)
  if (prismaPayment?.journalId) {
    const matched = await prisma.bankReconciliationMatch.findFirst({ where: { journalEntryId: prismaPayment.journalId, reversedAt: null }, select: { id: true } })
    if (matched) throw httpError('This payment is matched to a bank statement line — unmatch it in bank reconciliation first', 409)
  }

  return withAppStateKeyLock('deed_invoices', async () => {
    const state = await loadAppStateForWrite(['deed_invoices'])
    const invoices = (Array.isArray(state.deed_invoices) ? state.deed_invoices : []) as Row[]
    const inv = invoices.find(i => i.id === params.invoiceId)
    const pay = (Array.isArray(inv?.payments) ? inv!.payments : []).find((p: Row) => String(p.id) === params.paymentId)
    if (!inv || !pay) throw httpError('Payment not found on this document', 404)
    if (!moneyMoved(pay)) throw httpError('No money moved on this payment (a credit or deposit applied) — there is no bank to change', 409)
    const fromId = effectivePaymentBankId(pay)
    if (fromId === params.bankAccountId) throw httpError('The payment is already on that account', 409)

    const amount = Math.round(Number(pay.amount) * 100) / 100
    const fromLabel = await cashLabelForBankAccount(prisma, fromId)
    const toLabel = await cashLabelForBankAccount(prisma, params.bankAccountId)
    // Money came in on a customer invoice (or a supplier refund); went out on a bill.
    const moneyIn = inv.type === 'customer_invoice' ? Number(inv.total) >= 0 : Number(inv.total) < 0
    const changes = Array.isArray(pay.bankChanges) ? pay.bankChanges : []
    const journalRef = `JRN/PAYBANK/${params.paymentId}/${changes.length + 1}`.slice(0, 80)
    const fromName = bankAccountLabel(banks.find(b => b.id === fromId) as any, fromId)
    const toName = bankAccountLabel(target as any, params.bankAccountId)
    // Two screen accounts can share one ledger account: then nothing moves in the books.
    if (fromLabel !== toLabel && amount > 0) {
      await createJournalEntry({
        ref: journalRef,
        journalCode: 'BNK',
        date: now,
        description: `Payment ${inv.ref} moved from ${fromName} to ${toName}: ${reason}`.slice(0, 500),
        sourceType: 'payment_bank_change',
        sourceId: params.paymentId,
        invoiceId: isUuid(inv.id) ? inv.id : null,
        createdById: params.actor.id,
        skipIfExists: true,
        lines: moneyIn
          ? [
            { accountLabel: toLabel, label: `${inv.ref}: received into ${toName}`, debit: amount, credit: 0 },
            { accountLabel: fromLabel, label: `${inv.ref}: not received into ${fromName}`, debit: 0, credit: amount },
          ]
          : [
            { accountLabel: fromLabel, label: `${inv.ref}: not paid from ${fromName}`, debit: amount, credit: 0 },
            { accountLabel: toLabel, label: `${inv.ref}: paid from ${toName}`, debit: 0, credit: amount },
          ],
      })
    }
    if (prismaPayment) {
      await prisma.payment.update({ where: { id: prismaPayment.id }, data: { bankAccountId: isUuid(params.bankAccountId) ? params.bankAccountId : null } })
    }

    const change = { at: now.toISOString(), by: params.actor.name, from: fromId, to: params.bankAccountId, reason, journalRef: fromLabel !== toLabel ? journalRef : undefined }
    const next = invoices.map(i => i.id !== inv.id ? i : {
      ...i,
      payments: i.payments.map((p: Row) => String(p.id) !== params.paymentId ? p : { ...p, bankAccountId: params.bankAccountId, bankChanges: [...changes, change] }),
    })
    await saveStoreKeys({ deed_invoices: JSON.stringify(next) })
    await notifyStoreKeysChanged(['deed_invoices', 'deed_journalEntries']).catch(() => {})
    await writeFinancialAudit({
      userId: params.actor.id, action: 'change_payment_bank', entityType: 'payment', entityId: params.paymentId,
      oldValues: { bankAccountId: fromId }, newValues: { bankAccountId: params.bankAccountId, reason, journalRef: change.journalRef ?? null },
    }).catch(() => {})
    return { from: fromId, to: params.bankAccountId, fromName, toName, journalRef: change.journalRef ?? null }
  })
}
