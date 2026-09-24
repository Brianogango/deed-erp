/**
 * How much has actually been paid on an invoice.
 *
 * There are two records of this and they disagree for historical rows:
 *
 *  - `payment_allocations` — the itemised truth, one row per application of a
 *    payment to an invoice. Introduced later.
 *  - `invoices.amount_paid` — a running cache, written since the beginning.
 *
 * Invoices settled before payment_allocations existed have a correct
 * `amount_paid` and ZERO allocation rows. Summing allocations alone therefore
 * reports them as entirely unpaid, which inflated receivables by roughly two
 * million shillings in production.
 *
 * The ageing report was fixed for this; the accounting dashboard's overdue
 * figures and the integrity suite's AR/AP balances were not, and carried the
 * same inflation. Hence one shared definition rather than three copies.
 *
 * Callers decide which allocations count (reversed ones excluded, an as-of
 * date, and so on) and pass the already-filtered rows.
 */
export function invoicePaidAmount(invoice: {
  paymentAllocations?: readonly { amount: unknown }[] | null
  amountPaid?: unknown
}): number {
  const allocations = invoice.paymentAllocations ?? []
  if (allocations.length > 0) {
    return allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
  }
  return Number(invoice.amountPaid) || 0
}

/** Outstanding balance, never negative. */
export function invoiceOutstanding(invoice: {
  totalAmount?: unknown
  total?: unknown
  paymentAllocations?: readonly { amount: unknown }[] | null
  amountPaid?: unknown
}): number {
  const total = Number(invoice.totalAmount ?? invoice.total) || 0
  return Math.max(0, total - invoicePaidAmount(invoice))
}
