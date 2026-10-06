/**
 * Invoices with more than one live sales entry.
 *
 * A Finance → Migration import posted a sales entry for every invoice it
 * carried, under a new numbered ref (JRN/INV/<ref>/N) each time; a timed-out
 * import retried three times left up to four live copies per invoice, each
 * booking the revenue, VAT and receivable again. A reset-to-draft only
 * reversed the copy the browser knew about.
 *
 * Exactly one live entry per invoice is kept: one a person posted (the
 * import posted without a user) whose amount matches the invoice, latest
 * first; the others are reversed. Pure.
 */

export type LiveSalesEntry = {
  id: string
  ref: string
  invoiceId: string
  createdAt: Date | string
  createdById: string | null
  totalDebit: number
}

export type DuplicateInvoicePlan = {
  invoiceId: string
  invoiceNumber: string
  customer: string
  invoiceTotal: number
  keep: { id: string; ref: string; amount: number }
  reverse: Array<{ id: string; ref: string; amount: number }>
  /** The kept entry's amount differs from the invoice total — check it. */
  amountMismatch: boolean
}

const ms = (d: Date | string) => new Date(d).getTime()
const close = (a: number, b: number) => Math.abs(a - b) < 0.01

export function planDuplicateInvoiceJournals(
  invoices: Array<{ id: string; invoiceNumber: string; customer: string; total: number }>,
  entries: LiveSalesEntry[],
): DuplicateInvoicePlan[] {
  const byInvoice = new Map<string, LiveSalesEntry[]>()
  for (const e of entries) byInvoice.set(e.invoiceId, [...(byInvoice.get(e.invoiceId) ?? []), e])
  const plans: DuplicateInvoicePlan[] = []
  for (const inv of invoices) {
    const live = byInvoice.get(inv.id) ?? []
    if (live.length < 2) continue
    const rank = (e: LiveSalesEntry) => [
      e.createdById ? 1 : 0,
      close(e.totalDebit, inv.total) ? 1 : 0,
      ms(e.createdAt),
    ]
    const sorted = [...live].sort((a, b) => {
      const ra = rank(a), rb = rank(b)
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i]
      return 0
    })
    const [keep, ...rest] = sorted
    plans.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.customer,
      invoiceTotal: inv.total,
      keep: { id: keep.id, ref: keep.ref, amount: keep.totalDebit },
      reverse: rest.map(e => ({ id: e.id, ref: e.ref, amount: e.totalDebit })),
      amountMismatch: !close(keep.totalDebit, inv.total),
    })
  }
  return plans.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber))
}
