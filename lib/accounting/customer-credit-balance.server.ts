import 'server-only'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppStateForWrite, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { cashLabelForBankAccount } from '@/lib/accounting/bank-cash-account.server'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { writeFinancialAudit } from '@/lib/finance-audit'

/**
 * The customer's credit balance (deed_customerCredits; GL 3313 Customer
 * Credits). A credit note on an invoice the customer already paid leaves
 * money we owe them: it lands here, to be used on a later invoice or
 * refunded.
 */
const round2 = (n: number) => Math.round(n * 100) / 100
type CreditRow = Record<string, any>

async function editCredits<T>(edit: (list: CreditRow[]) => Promise<T>): Promise<T> {
  const result = await withAppStateKeyLock('deed_customerCredits', async () => {
    const fresh = await loadAppStateForWrite(['deed_customerCredits'])
    const list = Array.isArray(fresh.deed_customerCredits) ? fresh.deed_customerCredits as CreditRow[] : []
    const out = await edit(list)
    await saveStoreKeys({ deed_customerCredits: JSON.stringify(list) })
    return out
  })
  await notifyStoreKeysChanged(['deed_customerCredits']).catch(() => {})
  return result
}

/** Add what we owe the customer from a credit note (once per credit note ref). */
export async function addCustomerCreditBalance(input: {
  ref: string
  customerId: string
  customerName: string
  sourceInvoiceId: string
  sourceInvoiceRef: string
  amount: number
  createdBy: string
  notes: string
}) {
  if (!(input.amount > 0)) return
  await editCredits(async list => {
    if (list.some(c => c?.ref === input.ref)) return
    list.unshift({
      id: randomUUID(), ref: input.ref,
      customerId: input.customerId, customerName: input.customerName,
      sourceType: 'invoice', sourceInvoiceId: input.sourceInvoiceId, sourceInvoiceRef: input.sourceInvoiceRef,
      amount: round2(input.amount), balance: round2(input.amount), status: 'available',
      createdAt: new Date().toISOString(), createdBy: input.createdBy,
      notes: input.notes,
      applications: [],
    })
  })
}

export class CreditRefundError extends Error {
  constructor(message: string, public status = 422) { super(message) }
}

/**
 * Pay the customer's credit back: Dr 3313 Customer Credits / Cr the bank or
 * till it was paid from. Lowers the credit's balance.
 */
export async function refundCustomerCredit(input: {
  creditId: string
  amount: number
  method: string
  bankAccountId?: string | null
  reference?: string | null
  date: Date
  actor: { id: string; name: string }
}) {
  const amount = round2(Number(input.amount))
  if (!(amount > 0)) throw new CreditRefundError('Enter the amount refunded')
  const method = String(input.method || '').toLowerCase()
  if (!['cash', 'mpesa', 'bank_transfer', 'cheque'].includes(method)) throw new CreditRefundError('Pick how the refund was paid')

  return editCredits(async list => {
    const credit = list.find(c => c?.id === input.creditId)
    if (!credit) throw new CreditRefundError('Credit not found', 404)
    if (credit.status !== 'available' && credit.status !== 'partially_used') throw new CreditRefundError(`${credit.ref} has nothing left to refund`, 409)
    const balance = round2(Number(credit.balance) || 0)
    if (amount > balance + 0.009) throw new CreditRefundError(`Only ${balance.toLocaleString('en-KE')} is left on ${credit.ref}`, 409)

    const cashLabel = input.bankAccountId
      ? await cashLabelForBankAccount(prisma, input.bankAccountId)
      : labelForRole(method === 'bank_transfer' || method === 'cheque' ? 'bank_absa' : 'cash_mobile')
    const refunds = Array.isArray(credit.refunds) ? credit.refunds : []
    const journalRef = `JRN/CRREF/${credit.ref}/${refunds.length + 1}`.slice(0, 80)
    const customer = String(credit.customerName || 'customer')
    const journal = await createJournalEntry({
      ref: journalRef,
      journalCode: method === 'cash' || method === 'mpesa' ? 'CSH' : 'BNK',
      date: input.date,
      description: `Refund of customer credit ${credit.ref} to ${customer}${input.reference ? ` (${input.reference})` : ''}`,
      sourceType: 'customer_credit_refund',
      sourceId: String(credit.id),
      createdById: input.actor.id,
      lines: [
        { accountLabel: labelForRole('customer_credits'), label: `Credit ${credit.ref} refunded to ${customer}`, debit: amount, credit: 0 },
        { accountLabel: cashLabel, label: `Refund to ${customer}`, debit: 0, credit: amount },
      ],
    })

    const left = round2(balance - amount)
    credit.balance = left
    credit.status = left <= 0.009 ? 'used' : 'partially_used'
    credit.refunds = [...refunds, {
      id: randomUUID(), date: input.date.toISOString(), amount, method,
      reference: input.reference || undefined, bankAccountId: input.bankAccountId || undefined,
      journalRef, refundedBy: input.actor.name,
    }]
    await writeFinancialAudit({
      userId: input.actor.id, action: 'refund_customer_credit', entityType: 'customer_credit', entityId: String(credit.id),
      relatedJournalId: journal?.id, oldValues: { balance }, newValues: { balance: left, refunded: amount, method },
    }).catch(() => {})
    return { ref: String(credit.ref), refunded: amount, balance: left }
  })
}

/**
 * Cancel customer credit given in error — a double credit, a credit that
 * should not have been issued. Nothing is paid out: the credit goes down by
 * `amount` (all of what is left by default) and a journal undoes what
 * created it (lib/finance/cancel-customer-credit). Refused when the entry
 * that created the credit cannot be found, so the books are never guessed.
 */
export async function cancelCustomerCredit(input: {
  creditId: string
  amount?: number
  reason: string
  date: Date
  actor: { id: string; name: string }
}) {
  const reason = String(input.reason || '').trim()
  if (!reason) throw new CreditRefundError('Say why the credit is cancelled')
  const { cancelCreditJournalLines } = await import('@/lib/finance/cancel-customer-credit')

  return editCredits(async list => {
    const credit = list.find(c => c?.id === input.creditId)
    if (!credit) throw new CreditRefundError('Credit not found', 404)
    if (credit.status !== 'available' && credit.status !== 'partially_used') throw new CreditRefundError(`${credit.ref} has nothing left to cancel`, 409)
    const balance = round2(Number(credit.balance) || 0)
    const amount = round2(input.amount == null ? balance : Number(input.amount))
    if (!(amount > 0)) throw new CreditRefundError('Enter the amount to cancel')
    if (amount > balance + 0.009) throw new CreditRefundError(`Only ${balance.toLocaleString('en-KE')} is left on ${credit.ref}`, 409)

    const ref = String(credit.ref)
    const creditsLabel = labelForRole('customer_credits')
    const code = creditsLabel.split(' ')[0]
    const candidates = await prisma.journalEntry.findMany({
      where: { ref: { in: [`JRN/${ref}`, `JRN/CN/${ref}`, ref] }, isReversed: false },
      include: { lines: true },
    })
    const origin = candidates.find(j => j.lines.some(l => Number(l.credit) > 0 && (l.accountLabel === creditsLabel || l.accountLabel.split(' ')[0] === code)))
    const lines = origin
      ? cancelCreditJournalLines(origin.lines.map(l => ({ accountLabel: l.accountLabel, debit: Number(l.debit), credit: Number(l.credit) })), amount, creditsLabel, ref)
      : null
    if (!lines) {
      throw new CreditRefundError(`Can't find the entry that created ${ref}, so it can't be undone automatically — ask Finance to post a manual journal`, 409)
    }

    const cancels = Array.isArray(credit.cancellations) ? credit.cancellations : []
    const journalRef = `JRN/CRCAN/${ref}/${cancels.length + 1}`.slice(0, 80)
    const customer = String(credit.customerName || 'customer')
    const journal = await createJournalEntry({
      ref: journalRef,
      journalCode: 'SAL',
      date: input.date,
      description: `Customer credit ${ref} cancelled for ${customer}: ${reason}`,
      sourceType: 'customer_credit_cancel',
      sourceId: String(credit.id),
      createdById: input.actor.id,
      lines,
    })

    const left = round2(balance - amount)
    const touched = (Array.isArray(credit.applications) && credit.applications.length > 0) || (Array.isArray(credit.refunds) && credit.refunds.length > 0)
    credit.balance = left
    credit.status = left <= 0.009 ? (touched ? 'used' : 'void') : 'partially_used'
    credit.cancellations = [...cancels, {
      id: randomUUID(), date: input.date.toISOString(), amount, reason, journalRef, cancelledBy: input.actor.name,
    }]
    await writeFinancialAudit({
      userId: input.actor.id, action: 'cancel_customer_credit', entityType: 'customer_credit', entityId: String(credit.id),
      relatedJournalId: journal?.id, oldValues: { balance }, newValues: { balance: left, cancelled: amount, reason },
    }).catch(() => {})
    return { ref, cancelled: amount, balance: left }
  })
}
