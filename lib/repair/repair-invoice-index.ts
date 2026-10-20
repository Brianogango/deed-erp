/**
 * Which repairs each customer invoice bills.
 *
 * An invoice's own repairId is only one of the links: a repair billed through
 * its sale order, or several repairs billed together on one invoice, leave it
 * empty (or naming only the first repair). Reading the link from the repair's
 * side as well — its invoice, its sale order, repair lines on the invoice —
 * keeps that revenue on the repair dashboards instead of under general sales.
 */
type RepairLike = { id: string; invoiceId?: string | null; saleOrderId?: string | null }
type InvoiceLike = {
  id: string
  type?: string
  repairId?: string | null
  saleOrderId?: string | null
  lines?: Array<{ repairId?: string | null }> | null
}

export function repairsByInvoice(repairs: readonly RepairLike[], invoices: readonly InvoiceLike[]): Map<string, string[]> {
  const known = new Set(repairs.map(r => r.id))
  const byInvoice = new Map<string, Set<string>>()
  const add = (invoiceId: string, repairId: string) => {
    if (!invoiceId || !repairId || !known.has(repairId)) return
    const set = byInvoice.get(invoiceId) ?? new Set<string>()
    set.add(repairId)
    byInvoice.set(invoiceId, set)
  }

  const bySaleOrder = new Map<string, string[]>()
  for (const r of repairs) {
    if (r.invoiceId) add(String(r.invoiceId), r.id)
    if (r.saleOrderId) bySaleOrder.set(String(r.saleOrderId), [...(bySaleOrder.get(String(r.saleOrderId)) ?? []), r.id])
  }
  for (const inv of invoices) {
    if (inv.type === 'vendor_bill') continue
    if (inv.repairId) add(inv.id, String(inv.repairId))
    for (const l of inv.lines ?? []) if (l?.repairId) add(inv.id, String(l.repairId))
    if (inv.saleOrderId) for (const id of bySaleOrder.get(String(inv.saleOrderId)) ?? []) add(inv.id, id)
  }
  return new Map([...byInvoice.entries()].map(([k, v]) => [k, [...v]]))
}
