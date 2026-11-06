/**
 * The customer paid the rider the delivery charge directly, and paid the
 * rest of the invoice to the company. That money is between the customer and
 * the rider, so it stays off our books on both sides:
 *  - the delivery charge comes off the invoice (a draft loses or shrinks the
 *    line; a posted invoice gets a credit note for it), so it is not our
 *    revenue, VAT or receivable;
 *  - the rider's pay for that trip is the fee less what the customer paid
 *    them, never below zero (an extra is the rider's to keep). Only a
 *    top-up we pay is our expense.
 * Pure helpers.
 */

export const PAID_TO_RIDER = 'paid_to_rider'

/** Expense accounts for rider fees, first one that exists wins. */
export const RIDER_FEE_ACCOUNTS: Array<{ code: string; name: string }> = [
  { code: '6519', name: 'Courier and Delivery' },
  { code: '6401', name: 'Selling and Delivery' },
]

export function riderFeeAccount(existingCodes: Iterable<string>): { code: string; name: string; label: string } {
  const have = new Set([...existingCodes].map(c => String(c).trim()))
  const pick = RIDER_FEE_ACCOUNTS.find(a => have.has(a.code)) ?? RIDER_FEE_ACCOUNTS[0]
  return { ...pick, label: `${pick.code} - ${pick.name}` }
}

type JobLike = { riderFee?: number; customerPaidRider?: { amount: number } | null }

/** What we still owe the rider for a trip: the fee less what the customer paid them, never below zero. */
export const riderPayForJob = (job: JobLike) =>
  Math.max(0, Math.round(((Number(job.riderFee) || 0) - (Number(job.customerPaidRider?.amount) || 0)) * 100) / 100)

/** How much of the rider's fee the customer covered (what comes off our pay). */
export const feeCoveredByCustomer = (job: JobLike) =>
  Math.round(((Number(job.riderFee) || 0) - riderPayForJob(job)) * 100) / 100

export const paidDirectToRider = (job: JobLike) => Number(job.customerPaidRider?.amount) || 0

/** A "Delivery charge" line, as scheduling a delivery writes it. */
export const isDeliveryChargeLine = (description: unknown) => /^\s*delivery charge\b/i.test(String(description ?? ''))

/**
 * How much of a delivery line to take off for `amount` paid to the rider.
 * The line's price is before VAT; the share taken off carries its VAT with it.
 * `remainingQty` is the line's quantity not yet credited.
 */
export function deliveryLineCut(line: { qty: number; lineSubtotal: number }, remainingQty: number, amount: number): { qty: number; fraction: number } {
  const qty = Number(line.qty) || 0
  const remaining = Math.max(0, Math.min(qty, Number(remainingQty) || 0))
  if (!(qty > 0) || !(remaining > 0) || !(amount > 0)) return { qty: 0, fraction: 0 }
  const remainingSubtotal = (Number(line.lineSubtotal) || 0) * remaining / qty
  if (!(remainingSubtotal > 0)) return { qty: 0, fraction: 0 }
  const fraction = Math.min(1, amount / remainingSubtotal)
  const cutQty = fraction >= 0.9999 ? remaining : Math.round(remaining * fraction * 10000) / 10000
  return { qty: cutQty, fraction }
}

type BooksRecord = { creditNoteRef?: string; invoiceId?: string; invoiceRef?: string; removedFromDraft?: number; customerCredit?: number; pending?: string; settled?: number; fixedAt?: string; offBooksNote?: string }

/** One line for the office: where the money paid to the rider went on our books. */
export function paidRiderBooksText(r: BooksRecord): string {
  const k = (n: number) => `KES ${n.toLocaleString('en-KE')}`
  if (r.pending) return `not yet off the invoice: ${r.pending}`
  if (r.creditNoteRef) return `credit note ${r.creditNoteRef}${r.invoiceRef ? ` on ${r.invoiceRef}` : ''}${Number(r.customerCredit) > 0 ? ` — ${k(Number(r.customerCredit))} already paid to us is now customer credit (refund or use)` : ''} · off rider pay`
  if (Number(r.removedFromDraft) > 0) return `taken off draft ${r.invoiceRef ?? 'invoice'} · off rider pay`
  if (needsOffBooksFix({ customerPaidRider: r })) return `booked the old way on ${r.invoiceRef} — Finance: fix it from the banner above`
  return 'not on an invoice · off rider pay'
}

/** Trips settled the first way (a "paid to rider" payment on the invoice), still to be moved off the books. */
export function needsOffBooksFix(job: { customerPaidRider?: BooksRecord | null } | null | undefined): boolean {
  const r = job?.customerPaidRider
  if (!r || r.creditNoteRef || r.removedFromDraft || r.offBooksNote || r.fixedAt || r.pending) return false
  return Boolean(r.invoiceId) && (Number(r.settled) > 0 || r.settled === undefined)
}
