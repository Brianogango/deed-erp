/**
 * Resolve the invoice actually linked to a repair.
 *
 * IMPORTANT: never compare `inv.invoiceNumber === undefined` (or `inv.ref ===
 * undefined`) when the repair has no linkedInvoiceRef. Most invoices omit
 * `invoiceNumber`, so a bare `=== undefined` match binds every unlinked repair
 * to the first invoice in the list — historically INV/2026/0044 (KES 51,700).
 */
export type RepairInvoiceLink = {
  invoiceId?: string | null
  linkedInvoiceId?: string | null
  linkedInvoiceRef?: string | null
}

export type InvoiceLike = {
  id?: string | null
  ref?: string | null
  invoiceNumber?: string | null
}

function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function findRepairLinkedInvoice<T extends InvoiceLike>(
  invoices: T[],
  repair: RepairInvoiceLink,
): T | undefined {
  const invoiceKey = present(repair.invoiceId)
    ? repair.invoiceId
    : present(repair.linkedInvoiceId)
      ? repair.linkedInvoiceId
      : undefined
  const invoiceRef = present(repair.linkedInvoiceRef) ? repair.linkedInvoiceRef : undefined
  if (!invoiceKey && !invoiceRef) return undefined

  return invoices.find(inv =>
    (invoiceKey !== undefined && inv.id === invoiceKey) ||
    (invoiceRef !== undefined && (inv.ref === invoiceRef || inv.invoiceNumber === invoiceRef)),
  )
}
