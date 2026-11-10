/**
 * Records numbered in the browser (a per-browser counter, so every browser
 * started again at 0001) get real server numbers. Shared by refurbishment
 * jobs and stock adjustments.
 *
 * Pure.
 */

/** A stand-in from allocateDocNumberSync (e.g. ADJ/2026/L5K2J9QX), used until the server's number arrives. */
export function isProvisionalDocRef(ref: string | null | undefined): boolean {
  return /^[A-Z]+\/\d{4}\/L[0-9A-Z]+$/.test(String(ref ?? ''))
}

/**
 * Records to renumber: a stand-in number, a number an older record already
 * has, or — when `isFinal` is given — one not in the expected form. The
 * oldest record keeps its number.
 */
export function recordsNeedingNumbers<T extends { id: string; ref: string }>(
  records: T[],
  opts: { dateOf: (r: T) => string; isFinal?: (ref: string) => boolean },
): string[] {
  const isFinal = opts.isFinal ?? (ref => !!ref && !isProvisionalDocRef(ref))
  const seen = new Set<string>()
  const out: string[] = []
  const byAge = [...records].sort((a, b) => String(opts.dateOf(a)).localeCompare(String(opts.dateOf(b))))
  for (const r of byAge) {
    if (!isFinal(r.ref) || seen.has(r.ref)) out.push(r.id)
    else seen.add(r.ref)
  }
  return out
}

type AdjustmentLike = {
  id: string
  ref: string
  formerRef?: string
  productId: string
  type: string
  status: string
  date: string
  approvedDate?: string
}

/**
 * Approved adjustments whose stock value may never have posted. The
 * valuation step skips a number + product + direction it has already done,
 * so when two approved adjustments shared all three, only the first one
 * approved moved the stock value (stock itself moved for both).
 */
export function adjustmentsMissingValuation<T extends AdjustmentLike>(adjustments: T[]): T[] {
  const approved = adjustments
    .filter(a => a.status === 'approved')
    .sort((a, b) => String(a.approvedDate || a.date).localeCompare(String(b.approvedDate || b.date)))
  const seen = new Set<string>()
  const out: T[] = []
  for (const a of approved) {
    const key = `${a.formerRef || a.ref}|${a.productId}|${a.type}`
    if (seen.has(key)) out.push(a)
    else seen.add(key)
  }
  return out
}
