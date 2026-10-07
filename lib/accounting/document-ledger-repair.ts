/**
 * Two ways a document's ledger balance went wrong, found by
 * scripts/doc-reconcile.sql, and the repair for each:
 *
 *  - Payment booked more than once: one payment recorded on the document, two
 *    to five payment entries in the ledger (browser and server copies,
 *    retries). Each recorded payment keeps one entry — the one carrying its
 *    id — and the extra entries are reversed, never more than the excess.
 *    A document with NO payment recorded is never touched here: the ledger
 *    may be the only trace of real money, so it is listed for review.
 *  - Confirmed but not booked: reset to draft (which reversed the entry) and
 *    approved again without a new entry. It is booked again at its current
 *    amount.
 *
 * Pure — document-ledger-repair.server.ts reads and applies.
 */

export type PaymentEntry = { id: string; ref: string; paymentId: string | null; amount: number; createdAt: string }
type RecordedPayment = { id: string; amount: number }

export type ExtraPaymentPlan = {
  invoiceId: string
  ref: string
  recorded: number
  booked: number
  reverse: Array<{ ref: string; amount: number }>
}

const money = (n: number) => Math.round(n * 100) / 100

export function planExtraPaymentEntries(doc: {
  invoiceId: string
  ref: string
  payments: RecordedPayment[]
  entries: PaymentEntry[]
}): ExtraPaymentPlan | null {
  const live = doc.entries.filter(e => Math.abs(e.amount) > 0.005)
  const recorded = money(doc.payments.reduce((s, p) => s + p.amount, 0))
  const booked = money(live.reduce((s, e) => s + e.amount, 0))
  if (!(recorded > 0.5) || !(booked > recorded + 0.5)) return null

  const byAge = [...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ref.localeCompare(b.ref))
  const keep = new Set<string>()
  // 1. Each payment keeps the oldest entry that carries its id.
  for (const p of doc.payments) {
    const own = byAge.find(e => !keep.has(e.id) && (e.paymentId === p.id || e.ref.toLowerCase().endsWith(`/${p.id.toLowerCase()}`)))
    if (own) keep.add(own.id)
  }
  // 2. A payment with no entry of its own keeps the oldest unclaimed entry of its amount.
  for (const p of doc.payments) {
    const claimed = byAge.some(e => keep.has(e.id) && (e.paymentId === p.id || e.ref.toLowerCase().endsWith(`/${p.id.toLowerCase()}`)))
    if (claimed) continue
    const same = byAge.find(e => !keep.has(e.id) && Math.abs(e.amount - p.amount) < 0.01)
    if (same) keep.add(same.id)
  }
  // 3. Reverse the copies — entries the size of a recorded payment — newest
  //    first, never past the excess. Anything else is listed, not guessed.
  const sizes = doc.payments.map(p => p.amount)
  let excess = money(booked - recorded)
  const reverse: ExtraPaymentPlan['reverse'] = []
  for (const e of [...byAge].reverse()) {
    if (keep.has(e.id) || e.amount <= 0 || e.amount > excess + 0.5 || !sizes.some(a => Math.abs(a - e.amount) < 0.01)) continue
    reverse.push({ ref: e.ref, amount: e.amount })
    excess = money(excess - e.amount)
    if (excess <= 0.5) break
  }
  return reverse.length ? { invoiceId: doc.invoiceId, ref: doc.ref, recorded, booked, reverse } : null
}

/**
 * Reversals the browser posted as plain entries. "Reset to draft" in an old
 * tab posted REV/<ref> as a manual entry without marking <ref> as reversed,
 * so <ref> still looks live: INV/2026/0008 (2,000,000, reset on 5 Aug and
 * re-approved at 1,240,000.05) read as booked, and its new amount was never
 * booked. Linking the pair changes no balance — the reversal already posted —
 * it only records which entry it reversed, so the document can be booked.
 */
type LedgerEntryLite = { id: string; ref: string; total: number; invoiceId: string | null; isReversed: boolean; reversalOfId: string | null }
export type UnlinkedReversal = { reversalId: string; reversalRef: string; originalId: string; originalRef: string; amount: number }

export function planUnlinkedReversals(entries: LedgerEntryLite[]): UnlinkedReversal[] {
  const byRef = new Map(entries.map(e => [e.ref, e]))
  const out: UnlinkedReversal[] = []
  for (const rev of entries) {
    if (!rev.ref.startsWith('REV/') || rev.reversalOfId || rev.isReversed) continue
    const original = byRef.get(rev.ref.slice(4))
    if (!original || original.isReversed || original.reversalOfId) continue
    if ((original.invoiceId ?? null) !== (rev.invoiceId ?? null)) continue
    if (Math.abs(original.total - rev.total) > 0.005) continue
    out.push({ reversalId: rev.id, reversalRef: rev.ref, originalId: original.id, originalRef: original.ref, amount: original.total })
  }
  return out
}
