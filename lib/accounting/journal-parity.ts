/**
 * Journal deep parity (Finance Phase 9).
 * Compare blob `deed_journalEntries` to Prisma by **ref** (not id).
 * Prisma-ahead is OK (STK / FX / reconfig / engine-only journals).
 * Pure helpers — no DB.
 */

export type JournalBlobLike = {
  ref?: unknown
  totalDebit?: unknown
  totalCredit?: unknown
  lines?: Array<{ debit?: unknown; credit?: unknown }>
}

export type JournalRefCompareResult = {
  blobRefCount: number
  prismaRefCount: number
  matched: number
  blobOnlyRefs: string[]
  prismaOnlySample: string[]
  coveragePct: number | null
  /** Every blob ref exists in Prisma (Prisma may have extras). */
  ok: boolean
}

export type JournalAmountDriftSample = {
  ref: string
  blobDebit: number
  blobCredit: number
  prismaDebit: number
  prismaCredit: number
}

export type JournalAmountDriftResult = {
  sampled: number
  mismatched: number
  samples: JournalAmountDriftSample[]
  ok: boolean
}

export type JournalDeepParityResult = {
  ok: boolean
  blobCount: number
  prismaCount: number
  refs: JournalRefCompareResult
  amountDrift: JournalAmountDriftResult
  blockedReason?: string
}

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

function parseBlobRows(raw: string | null | undefined): JournalBlobLike[] {
  if (raw == null || raw === '') return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as JournalBlobLike[]
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
      return (parsed as { items: JournalBlobLike[] }).items
    }
    return []
  } catch {
    return []
  }
}

/** Unique non-empty journal refs from a blob JSON array. */
export function extractJournalRefs(raw: string | null | undefined, limit = 10000): string[] {
  const rows = parseBlobRows(raw)
  const seen = new Set<string>()
  const refs: string[] = []
  for (const row of rows) {
    const ref = typeof row?.ref === 'string' ? row.ref.trim() : ''
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    refs.push(ref)
    if (refs.length >= limit) break
  }
  return refs
}

export function blobJournalTotals(entry: JournalBlobLike): { debit: number; credit: number } {
  if (entry.totalDebit != null || entry.totalCredit != null) {
    return {
      debit: round2(Number(entry.totalDebit || 0)),
      credit: round2(Number(entry.totalCredit || 0)),
    }
  }
  let debit = 0
  let credit = 0
  for (const line of entry.lines || []) {
    debit += Number(line?.debit || 0)
    credit += Number(line?.credit || 0)
  }
  return { debit: round2(debit), credit: round2(credit) }
}

export function compareJournalRefSets(
  blobRefs: string[],
  prismaRefs: Iterable<string>,
  opts?: { blobOnlyLimit?: number; prismaOnlyLimit?: number },
): JournalRefCompareResult {
  const prismaSet = prismaRefs instanceof Set ? prismaRefs : new Set([...prismaRefs].map(r => String(r).trim()).filter(Boolean))
  const blobOnlyRefs: string[] = []
  let matched = 0
  const blobOnlyLimit = opts?.blobOnlyLimit ?? 25
  const prismaOnlyLimit = opts?.prismaOnlyLimit ?? 25

  for (const ref of blobRefs) {
    if (prismaSet.has(ref)) matched++
    else if (blobOnlyRefs.length < blobOnlyLimit) blobOnlyRefs.push(ref)
  }

  const blobSet = new Set(blobRefs)
  const prismaOnlySample: string[] = []
  for (const ref of prismaSet) {
    if (!blobSet.has(ref)) {
      prismaOnlySample.push(ref)
      if (prismaOnlySample.length >= prismaOnlyLimit) break
    }
  }

  const blobRefCount = blobRefs.length
  const prismaRefCount = prismaSet.size
  const coveragePct = blobRefCount > 0
    ? Number((matched / blobRefCount).toFixed(4))
    : prismaRefCount === 0
      ? 1
      : null

  return {
    blobRefCount,
    prismaRefCount,
    matched,
    blobOnlyRefs,
    prismaOnlySample,
    coveragePct,
    ok: blobOnlyRefs.length === 0 && matched === blobRefCount,
  }
}

export function sampleJournalAmountDrift(
  blobEntries: JournalBlobLike[],
  prismaByRef: Map<string, { debit: number; credit: number }>,
  sampleSize = 25,
  tolerance = 0.02,
): JournalAmountDriftResult {
  const samples: JournalAmountDriftSample[] = []
  let sampled = 0
  let mismatched = 0

  for (const entry of blobEntries) {
    if (sampled >= sampleSize) break
    const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : ''
    if (!ref) continue
    const prisma = prismaByRef.get(ref)
    if (!prisma) continue
    sampled++
    const blob = blobJournalTotals(entry)
    const drift =
      Math.abs(blob.debit - prisma.debit) > tolerance
      || Math.abs(blob.credit - prisma.credit) > tolerance
    if (drift) {
      mismatched++
      samples.push({
        ref,
        blobDebit: blob.debit,
        blobCredit: blob.credit,
        prismaDebit: prisma.debit,
        prismaCredit: prisma.credit,
      })
    }
  }

  return {
    sampled,
    mismatched,
    samples,
    ok: mismatched === 0,
  }
}

/**
 * Pure deep parity from already-loaded blob JSON + Prisma ref/total maps.
 */
export function evaluateJournalDeepParity(opts: {
  blobRaw: string | null | undefined
  prismaRefs: Iterable<string>
  prismaTotalsByRef?: Map<string, { debit: number; credit: number }>
  prismaCount?: number
  amountSampleSize?: number
}): JournalDeepParityResult {
  const rows = parseBlobRows(opts.blobRaw)
  const blobRefs = extractJournalRefs(opts.blobRaw)
  const refs = compareJournalRefSets(blobRefs, opts.prismaRefs)
  const prismaCount = opts.prismaCount ?? refs.prismaRefCount
  const amountDrift = opts.prismaTotalsByRef
    ? sampleJournalAmountDrift(rows, opts.prismaTotalsByRef, opts.amountSampleSize ?? 25)
    : { sampled: 0, mismatched: 0, samples: [], ok: true }

  const ok = refs.ok && amountDrift.ok
  let blockedReason: string | undefined
  if (!refs.ok) {
    blockedReason = `Journal ref gap: ${refs.blobOnlyRefs.length} blob ref(s) missing in Prisma (coverage ${refs.coveragePct})`
  } else if (!amountDrift.ok) {
    blockedReason = `Journal amount drift on ${amountDrift.mismatched}/${amountDrift.sampled} sampled overlapping refs`
  }

  return {
    ok,
    blobCount: rows.length,
    prismaCount,
    refs,
    amountDrift,
    blockedReason,
  }
}
