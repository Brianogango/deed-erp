/**
 * Invoices and bills with more than one live posting entry.
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
  /** 'cancelled': the document is cancelled/voided, so nothing is kept. */
  reason: 'duplicate' | 'cancelled'
  keep: { id: string; ref: string; amount: number } | null
  reverse: Array<{ id: string; ref: string; amount: number }>
  /** The kept entry's amount differs from the invoice total — check it. */
  amountMismatch: boolean
}

const ms = (d: Date | string) => new Date(d).getTime()
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The document's own posting entry: JRN/<number> or a numbered copy of it
 * (JRN/<number>/2, /3, …). Not a delivery charge (JRN/DEL/…), payment
 * (JRN/PAY/…) or anything else that also carries the document's id.
 */
export function isPostingRef(ref: string, invoiceNumber: string): boolean {
  if (!invoiceNumber) return false
  return new RegExp(`^JRN/${escape(invoiceNumber)}(/\\d+)?$`).test(ref)
}
const close = (a: number, b: number) => Math.abs(a - b) < 0.01

export function planDuplicateInvoiceJournals(
  invoices: Array<{ id: string; invoiceNumber: string; customer: string; total: number }>,
  entries: LiveSalesEntry[],
): DuplicateInvoicePlan[] {
  const numberOf = new Map(invoices.map(i => [i.id, i.invoiceNumber]))
  const byInvoice = new Map<string, LiveSalesEntry[]>()
  for (const e of entries) {
    if (!isPostingRef(e.ref, numberOf.get(e.invoiceId) ?? '')) continue
    byInvoice.set(e.invoiceId, [...(byInvoice.get(e.invoiceId) ?? []), e])
  }
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
      reason: 'duplicate',
      keep: { id: keep.id, ref: keep.ref, amount: keep.totalDebit },
      reverse: rest.map(e => ({ id: e.id, ref: e.ref, amount: e.totalDebit })),
      amountMismatch: !close(keep.totalDebit, inv.total),
    })
  }
  return plans.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber))
}

/**
 * Cancelled / voided documents whose entries are still live: every entry
 * carrying the document (posting, delivery charge) is reversed. Its number
 * may have reverted to a DRAFT/… placeholder, so entries are matched by id.
 */
export function planCancelledStillBooked(
  invoices: Array<{ id: string; invoiceNumber: string; customer: string; total: number }>,
  entries: LiveSalesEntry[],
): DuplicateInvoicePlan[] {
  return invoices.flatMap(inv => {
    const live = entries.filter(e => e.invoiceId === inv.id)
    if (!live.length) return []
    return [{
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.customer,
      invoiceTotal: inv.total,
      reason: 'cancelled' as const,
      keep: null,
      reverse: live.map(e => ({ id: e.id, ref: e.ref, amount: e.totalDebit })),
      amountMismatch: false,
    }]
  })
}
