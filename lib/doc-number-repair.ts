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

/**
 * Records whose stock value may never have posted. The valuation step skips
 * a number + product (+ direction) it has already done, so when two posted
 * records shared that key, only the first one posted moved the stock value
 * (the stock itself moved for both). `keysOf` gives a record's keys (several
 * for a record with several products), using its number at the time it posted.
 */
export function valuationSkippedByRepeat<T>(
  records: T[],
  opts: { posted: (r: T) => boolean; postedAt: (r: T) => string; keysOf: (r: T) => string[] },
): T[] {
  const done = records.filter(opts.posted).sort((a, b) => String(opts.postedAt(a)).localeCompare(String(opts.postedAt(b))))
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of done) {
    const keys = opts.keysOf(r)
    if (keys.some(k => seen.has(k))) out.push(r)
    keys.forEach(k => seen.add(k))
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

/** Approved adjustments that repeated an earlier one's number, product and direction. */
export function adjustmentsMissingValuation<T extends AdjustmentLike>(adjustments: T[]): T[] {
  return valuationSkippedByRepeat(adjustments, {
    posted: a => a.status === 'approved',
    postedAt: a => a.approvedDate || a.date,
    keysOf: a => [`${a.formerRef || a.ref}|${a.productId}|${a.type}`],
  })
}

type ReturnLike = {
  id: string
  ref: string
  formerRef?: string
  receivedDate?: string
  lines: Array<{ productId: string }>
}

/** Received returns that repeated an earlier received return's number for one of the same products. */
export function returnsMissingValuation<T extends ReturnLike>(returns: T[]): T[] {
  return valuationSkippedByRepeat(returns, {
    posted: r => !!r.receivedDate,
    postedAt: r => String(r.receivedDate),
    keysOf: r => [...new Set(r.lines.map(l => `${r.formerRef || r.ref}|${l.productId}`))],
  })
}

/** Numbers held by more than one record, oldest first within each. */
export function repeatedRefs<T extends { ref: string }>(records: T[], dateOf: (r: T) => string): Array<{ ref: string; records: T[] }> {
  const groups = new Map<string, T[]>()
  for (const r of records) groups.set(r.ref, [...(groups.get(r.ref) ?? []), r])
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([ref, list]) => ({ ref, records: [...list].sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b)))) }))
}
