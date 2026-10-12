/**
 * Resolve the invoice actually linked to a repair.
 *
 * IMPORTANT: never compare `inv.invoiceNumber === undefined` (or `inv.ref ===
 * undefined`) when the repair has no linkedInvoiceRef. Most invoices omit
 * `invoiceNumber`, so a bare `=== undefined` match binds every unlinked repair
 * to the first invoice in the list — historically INV/2026/0044 (KES 51,700).
 */
type RepairInvoiceLink = {
  id?: string | null
  invoiceId?: string | null
  linkedInvoiceId?: string | null
  linkedInvoiceRef?: string | null
  saleOrderId?: string | null
  linkedSaleOrderId?: string | null
  previousInvoiceIds?: string[] | null
}

type InvoiceLike = {
  id?: string | null
  ref?: string | null
  invoiceNumber?: string | null
  repairId?: string | null
  saleOrderId?: string | null
  status?: string | null
  type?: string | null
  isDownPayment?: boolean | null
  date?: string | null
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
  if (invoiceKey || invoiceRef) {
    const linked = invoices.find(inv =>
      (invoiceKey !== undefined && inv.id === invoiceKey) ||
      (invoiceRef !== undefined && (inv.ref === invoiceRef || inv.invoiceNumber === invoiceRef)),
    )
    if (linked) return linked
  }

  // Many repair invoices are linked the other way round: the invoice names
  // the repair, or the repair's sale order. Only those exact links count —
  // never "the first invoice" — and drafts, cancelled, down-payment and
  // replaced invoices are skipped. The newest match wins.
  const repairId = present(repair.id) ? repair.id : undefined
  const saleOrderIds = [repair.saleOrderId, repair.linkedSaleOrderId].filter(present)
  if (!repairId && saleOrderIds.length === 0) return undefined
  const replaced = new Set((repair.previousInvoiceIds ?? []).filter(present))
  const candidates = invoices.filter(inv =>
    ((repairId !== undefined && inv.repairId === repairId) || (present(inv.saleOrderId) && saleOrderIds.includes(inv.saleOrderId)))
    && (!inv.type || inv.type === 'customer_invoice')
    && !inv.isDownPayment
    && !['draft', 'cancelled'].includes(String(inv.status ?? ''))
    && !(present(inv.id) && replaced.has(inv.id)),
  )
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))[0]
}
