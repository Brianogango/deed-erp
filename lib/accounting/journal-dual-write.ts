/**
 * Client-safe journal dual-write helper (Finance Phase 11).
 * Keeps local blob UI journals, and fire-and-forgets Prisma persist (idempotent ref).
 * Does not enable ACCOUNTING_POSTING_ENGINE.
 */

export type DualWriteJournalLike = {
  ref: string
  date?: string
  description?: string
  source?: string
  invoiceId?: string
  paymentId?: string
  expenseId?: string
  posOrderId?: string
  lines: Array<{
    account: string
    description?: string
    debit?: number
    credit?: number
  }>
}

/** Queue Prisma persist for a blob journal. Safe to call from the browser store. */
export function queueJournalPrismaPersist(entry: DualWriteJournalLike): void {
  const ref = String(entry.ref || '').trim()
  if (!ref || !Array.isArray(entry.lines) || entry.lines.length === 0) return

  const sourceId = entry.expenseId || entry.posOrderId || entry.invoiceId || entry.paymentId || null
  void fetch('/api/accounting/journals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref,
      description: entry.description || ref,
      date: entry.date || new Date().toISOString().slice(0, 10),
      source: entry.source || 'manual',
      sourceType: entry.source || 'manual',
      sourceId,
      skipIfExists: true,
      lines: entry.lines.map(l => ({
        account: l.account,
        description: l.description || '',
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      })),
    }),
  }).catch(() => {})
}
