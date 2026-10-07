/**
 * Supplier-bill payments booked as customer receipts.
 *
 * Until the fix in app/api/invoices/[id]/payments, paying a bill posted
 * Dr bank / Cr 1800 Accounts Receivable — the bank went UP by the amount paid
 * out and receivables went down — instead of Dr 3000 Accounts Payable /
 * Cr bank. The browser built the right entry under the same ref, so the
 * ledger kept the wrong one.
 *
 * Per payment: every live wrong entry is reversed; when no correct entry
 * exists for the payment, the correct one is posted. Pure — the server side
 * (bill-payment-fix.server.ts) posts what this plans.
 */

export type FixJournalLine = { accountLabel: string; debit: number; credit: number }
export type FixJournal = { id: string; ref: string; entryDate: Date | string; isReversed: boolean; lines: FixJournalLine[] }

export type BillPaymentFixPlan = {
  paymentId: string
  billId: string
  billNumber: string
  supplier: string
  amount: number
  paidAt: string
  /** Wrong entries to reverse. */
  reverse: Array<{ id: string; ref: string; amount: number }>
  /** Bank / cash account the money actually left from. */
  cashAccount: string
  /** Post the correct Dr AP / Cr bank entry (none exists yet). */
  postCorrect: boolean
}

const AR = '1800'
const AP = '3000'
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const code = (label: string) => String(label ?? '').trim().split(/\s+/)[0]

/** Dr bank / Cr receivables, with no payables line: a bill payment booked as a receipt. */
function isReceiptShaped(j: FixJournal): boolean {
  const creditsAr = j.lines.some(l => code(l.accountLabel) === AR && money(l.credit) > 0)
  const touchesAp = j.lines.some(l => code(l.accountLabel) === AP)
  return creditsAr && !touchesAp
}

function isPayableShaped(j: FixJournal): boolean {
  return j.lines.some(l => code(l.accountLabel) === AP && money(l.debit) > 0)
}

export function planBillPaymentFix(input: {
  payment: { id: string; amount: number; paidAt: Date | string }
  bill: { id: string; invoiceNumber: string; supplier: string }
  journals: FixJournal[]
}): BillPaymentFixPlan | null {
  const live = input.journals.filter(j => !j.isReversed)
  const wrong = live.filter(isReceiptShaped)
  if (!wrong.length) return null
  const cashLine = wrong[0].lines.find(l => code(l.accountLabel) !== AR && money(l.debit) > 0)
  if (!cashLine) return null
  return {
    paymentId: input.payment.id,
    billId: input.bill.id,
    billNumber: input.bill.invoiceNumber,
    supplier: input.bill.supplier,
    amount: money(input.payment.amount),
    paidAt: new Date(input.payment.paidAt).toISOString().slice(0, 10),
    reverse: wrong.map(j => ({ id: j.id, ref: j.ref, amount: money(j.lines.reduce((s, l) => s + money(l.debit), 0)) })),
    cashAccount: cashLine.accountLabel,
    postCorrect: !live.some(isPayableShaped),
  }
}

/** The correct entry for a bill payment. */
export function correctBillPaymentLines(plan: BillPaymentFixPlan, apLabel: string) {
  return [
    { accountLabel: apLabel, label: `AP settlement ${plan.billNumber}`, debit: plan.amount, credit: 0 },
    { accountLabel: plan.cashAccount, label: `Payment for ${plan.billNumber}`, debit: 0, credit: plan.amount },
  ]
}
