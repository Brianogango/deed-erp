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
