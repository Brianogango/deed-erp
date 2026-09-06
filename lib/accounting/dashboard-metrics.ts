/**
 * Shared money helpers for Finance dashboard cards.
 * Kept out of the route so collection/revenue math can be unit-tested.
 */

export function collectedOnInvoice(invoice: {
  amountPaid?: unknown
  paymentAllocations?: readonly { amount: unknown }[]
}): number {
  const allocations = invoice.paymentAllocations ?? []
  const allocatedRows = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0)
  // Older settled invoices often have amountPaid only — no allocation rows.
  return allocations.length > 0 ? allocatedRows : Number(invoice.amountPaid ?? 0)
}

export const ACTIVE_INVOICE_STATUS_FILTER = {
  notIn: ['draft', 'cancelled', 'voided'] as Array<'draft' | 'cancelled' | 'voided'>,
}
