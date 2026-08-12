/**
 * Bank statement ↔ cashbook / outstanding payment match helpers (Finance Phase 5).
 * Pure domain math — store UI remains the SoT for blob statement lines.
 */

import { roundMoney } from '@/lib/accounting/money'
import { paymentUnallocated } from '@/lib/accounting/residuals'

export type MatchableStatementLine = {
  id: string
  date: string
  debit: number
  credit: number
  reference?: string
  description?: string
  matchedEntryId?: string
  category?: string
}

export type MatchableCashbookEntry = {
  id: string
  date: string
  debit: number
  credit: number
  ref?: string
  description?: string
}

export type OutstandingPaymentCandidate = {
  id: string
  amount: number
  allocatedSum: number
  paidAt: string | Date
  reference?: string | null
  notes?: string | null
  /** inbound = customer receipt (statement credit); outbound = vendor payment (statement debit) */
  direction?: 'inbound' | 'outbound'
}

export type StatementMatchOptions = {
  /** Max absolute amount difference (KES). Default 1. */
  amountTolerance?: number
  /** Max calendar-day gap. Default 5. */
  dayTolerance?: number
}

function dayDiff(a: string | Date, b: string | Date): number {
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(ta - tb) / 86400000
}

/**
 * Lower score is better. Returns null when outside tolerances.
 * Statement credit matches cashbook credit (money in); debit ↔ debit.
 */
export function scoreStatementCashbookMatch(
  stmt: MatchableStatementLine,
  entry: MatchableCashbookEntry,
  opts?: StatementMatchOptions,
): number | null {
  const amountTolerance = opts?.amountTolerance ?? 1
  const dayTolerance = opts?.dayTolerance ?? 5
  const direction = Number(stmt.credit) > 0 ? 'credit' : 'debit'
  const stmtAmt = direction === 'credit' ? Number(stmt.credit) : Number(stmt.debit)
  const entryAmt = direction === 'credit' ? Number(entry.credit) : Number(entry.debit)
  if (stmtAmt <= 0 || entryAmt <= 0) return null
  const amtDiff = Math.abs(entryAmt - stmtAmt)
  const days = dayDiff(entry.date, stmt.date)
  if (amtDiff > amountTolerance || days > dayTolerance) return null
  let score = amtDiff * 10 + days
  // Soft bonus when bank ref appears in cashbook ref/description
  const ref = String(stmt.reference || '').trim().toLowerCase()
  if (ref && ref.length >= 4) {
    const hay = `${entry.ref || ''} ${entry.description || ''}`.toLowerCase()
    if (hay.includes(ref)) score -= 2
  }
  return score
}

/**
 * Auto-match unmatched statement lines to cashbook entries (greedy best score).
 * Returns updated statement lines (same array length) and match count.
 */
export function autoMatchStatementLines<T extends MatchableStatementLine>(params: {
  statementLines: T[]
  cashbookEntries: MatchableCashbookEntry[]
  bankAccountId: string
  month: string
  /** Filter predicate already applied externally if needed; when set, only these stmt ids are considered. */
  opts?: StatementMatchOptions
}): { lines: T[]; matchedCount: number } {
  const usedEntries = new Set(
    params.statementLines
      .filter(l => l.matchedEntryId)
      .map(l => l.matchedEntryId as string),
  )
  let matchedCount = 0
  const lines = params.statementLines.map(stmt => {
    // Caller filters by bank/month; still skip already matched
    if (stmt.matchedEntryId) return stmt
    let best: { id: string; score: number } | null = null
    for (const entry of params.cashbookEntries) {
      if (usedEntries.has(entry.id)) continue
      const score = scoreStatementCashbookMatch(stmt, entry, params.opts)
      if (score == null) continue
      if (!best || score < best.score) best = { id: entry.id, score }
    }
    if (best) {
      usedEntries.add(best.id)
      matchedCount++
      return { ...stmt, matchedEntryId: best.id }
    }
    return stmt
  })
  return { lines, matchedCount }
}

/**
 * Suggest outstanding Prisma payments that could explain an unmatched statement line.
 * Receipt (credit) ↔ inbound unallocated; payment (debit) ↔ outbound unallocated.
 */
export function suggestOutstandingPaymentMatches(params: {
  statementLine: MatchableStatementLine
  payments: OutstandingPaymentCandidate[]
  opts?: StatementMatchOptions
}): Array<{ paymentId: string; unallocated: number; score: number }> {
  const amountTolerance = params.opts?.amountTolerance ?? 1
  const dayTolerance = params.opts?.dayTolerance ?? 5
  const isCredit = Number(params.statementLine.credit) > 0
  const stmtAmt = isCredit
    ? Number(params.statementLine.credit)
    : Number(params.statementLine.debit)
  if (stmtAmt <= 0) return []

  const wantDirection = isCredit ? 'inbound' : 'outbound'
  const results: Array<{ paymentId: string; unallocated: number; score: number }> = []

  for (const p of params.payments) {
    const unallocated = paymentUnallocated(Number(p.amount), Number(p.allocatedSum))
    if (unallocated <= 0.009) continue
    const direction = p.direction
      || (String(p.notes || '').includes('direction:outbound') ? 'outbound' : 'inbound')
    if (direction !== wantDirection) continue
    const amtDiff = Math.abs(unallocated - stmtAmt)
    const days = dayDiff(p.paidAt, params.statementLine.date)
    if (amtDiff > amountTolerance || days > dayTolerance) continue
    let score = amtDiff * 10 + days
    const ref = String(params.statementLine.reference || '').trim().toLowerCase()
    if (ref && p.reference && String(p.reference).toLowerCase().includes(ref)) score -= 2
    results.push({ paymentId: p.id, unallocated: roundMoney(unallocated), score })
  }

  return results.sort((a, b) => a.score - b.score)
}

/** Unmatched bank_charge lines eligible for GL posting. */
export function unmatchedBankChargeTotal(
  lines: ReadonlyArray<MatchableStatementLine & { category?: string }>,
): number {
  return roundMoney(
    lines
      .filter(l => !l.matchedEntryId && l.category === 'bank_charge')
      .reduce((s, l) => s + Number(l.debit || 0), 0),
  )
}

export function unmatchedInterestEarnedTotal(
  lines: ReadonlyArray<MatchableStatementLine & { category?: string }>,
): number {
  return roundMoney(
    lines
      .filter(l => !l.matchedEntryId && l.category === 'interest_earned')
      .reduce((s, l) => s + Number(l.credit || 0), 0),
  )
}
