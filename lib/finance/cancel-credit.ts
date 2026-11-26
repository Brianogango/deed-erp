/**
 * How much a customer gets back as credit when a paid invoice is cancelled.
 *
 * What they paid, less what was already credited on the invoice: a credit
 * note (its share given as a credit balance or applied to the unpaid part,
 * which the invoice counts as paid) or a credit note issued from the sale
 * order. Crediting the full payment again gave the same money twice.
 */
const round2 = (n: number) => Math.round(n * 100) / 100

export function cancelCreditAmount(input: { amountPaid: number; total: number; alreadyCredited: number }): number {
  const paid = Math.min(Math.max(0, Number(input.amountPaid) || 0), Math.max(0, Number(input.total) || 0))
  return Math.max(0, round2(paid - Math.max(0, Number(input.alreadyCredited) || 0)))
}

/** What a cancelled invoice still has open in receivables: never paid, never credited. */
export function openReceivable(input: { total: number; amountPaid: number }): number {
  return Math.max(0, round2((Number(input.total) || 0) - (Number(input.amountPaid) || 0)))
}

/**
 * The journal that undoes what is left of a cancelled invoice's sale: the
 * customer's money back as credit, and the unpaid balance off receivables.
 * Sales and VAT are reversed on both, in the invoice's own proportion, and
 * the lines always balance.
 */
export function cancelReversal(input: { total: number; subtotal: number; tax: number; credit: number; receivable: number }) {
  const credit = round2(Math.max(0, input.credit))
  const receivable = round2(Math.max(0, input.receivable))
  const base = round2(credit + receivable)
  const total = Number(input.total) || 0
  const hasVat = (Number(input.tax) || 0) > 0 && total > 0
  const revenue = hasVat ? round2(base * (Number(input.subtotal) || 0) / total) : base
  const vat = hasVat ? round2(base - revenue) : 0
  return { revenue, vat, credit, receivable, total: base }
}
