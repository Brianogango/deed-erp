/**
 * Opening balances from an old system.
 *
 * A migrated customer balance or supplier bill is not a sale or a purchase of
 * this period — the sale happened in the old system (IFRS 15; IFRS for SMEs
 * s.23; accrual basis). Only the statement of financial position carries
 * over: the receivable or payable is posted against 4004 Opening Balance
 * Equity, a clearing account the accountant transfers to Retained Earnings
 * once the whole opening trial balance is in.
 *
 *   customer:  Dr 1800 Accounts Receivable   / Cr 4004 Opening Balance Equity
 *   supplier:  Dr 4004 Opening Balance Equity / Cr 3000 Accounts Payable
 *
 * Imports before this posted them as revenue / expense (or, when the ledger
 * refused their ids, not at all); planOpeningBalanceCorrection works out the
 * journal that puts each one right. Pure — shared by API routes and pages.
 */

export const OPENING_BALANCE_EQUITY_CODE = '4004'
export const OPENING_BALANCE_EQUITY_LABEL = '4004 - Opening Balance Equity'
/** Kept in the server invoice's internal notes. */
export const OPENING_BALANCE_MARKER = '[opening-balance]'

/** The wording every version of the importer put on its documents. */
export const MIGRATED_TEXT = 'Opening balance migrated from previous system'

type DocLike = {
  id?: unknown
  type?: unknown
  isOpeningBalance?: unknown
  internalNotes?: unknown
  notes?: unknown
  lines?: unknown
}

/**
 * Migrated opening balance: flagged by the importer, an id from the first
 * importer, or the importer's own wording on the document (imports made
 * before the flag existed).
 */
export function isOpeningBalanceDocument(doc: DocLike | null | undefined): boolean {
  if (!doc) return false
  if (doc.isOpeningBalance === true) return true
  if (String(doc.id ?? '').startsWith('mig_invoice_')) return true
  if (String(doc.internalNotes ?? '').includes(OPENING_BALANCE_MARKER)) return true
  if (String(doc.notes ?? '').trim() === MIGRATED_TEXT) return true
  const lines = Array.isArray(doc.lines) ? doc.lines as Array<{ description?: unknown }> : []
  return lines.length === 1 && String(lines[0]?.description ?? '').trim() === MIGRATED_TEXT
}

export type JournalLineDraft = { accountLabel: string; label: string; debit: number; credit: number }

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

/** The correct journal for one opening balance document. */
export function openingBalanceJournalLines(params: {
  type: 'customer_invoice' | 'vendor_bill'
  partner: string
  ref: string
  amount: number
  arLabel: string
  apLabel: string
}): JournalLineDraft[] {
  const amount = money(params.amount)
  if (params.type === 'vendor_bill') {
    return [
      { accountLabel: OPENING_BALANCE_EQUITY_LABEL, label: `Opening balance ${params.ref}`, debit: amount, credit: 0 },
      { accountLabel: params.apLabel, label: `AP: ${params.partner} — opening balance`, debit: 0, credit: amount },
    ]
  }
  return [
    { accountLabel: params.arLabel, label: `AR: ${params.partner} — opening balance`, debit: amount, credit: 0 },
    { accountLabel: OPENING_BALANCE_EQUITY_LABEL, label: `Opening balance ${params.ref}`, debit: 0, credit: amount },
  ]
}

type ExistingJournalLine = {
  accountLabel: string
  /** revenue | expense | asset | liability | equity, from the chart. */
  accountType: string | null
  debit: number
  credit: number
}

export type CorrectionPlan =
  | { action: 'ok'; reason: string }
  | { action: 'post'; reason: string; lines: JournalLineDraft[] }
  | { action: 'reclass'; reason: string; lines: JournalLineDraft[] }
  | { action: 'review'; reason: string }

const startsWithCode = (label: string, code: string) => label.trim().startsWith(code)

/**
 * What one already-imported opening balance needs.
 * - no journal: post the opening balance journal
 * - revenue / expense lines: move exactly those amounts to 4004
 * - already against 4004: nothing
 * - anything unusual (reversed, VAT, mixed): leave for the accountant
 */
export function planOpeningBalanceCorrection(params: {
  doc: { type: 'customer_invoice' | 'vendor_bill'; ref: string; partner: string; amount: number }
  journal: { isReversed?: boolean; lines: ExistingJournalLine[] } | null
  alreadyCorrected: boolean
  arLabel: string
  apLabel: string
}): CorrectionPlan {
  const { doc, journal } = params
  if (params.alreadyCorrected) return { action: 'ok', reason: 'Correction already posted' }
  if (money(doc.amount) <= 0) return { action: 'review', reason: 'No positive amount' }

  if (!journal) {
    return {
      action: 'post',
      reason: 'Never reached the ledger — posting the opening balance journal',
      lines: openingBalanceJournalLines({ ...doc, arLabel: params.arLabel, apLabel: params.apLabel }),
    }
  }
  if (journal.isReversed) return { action: 'review', reason: 'Its journal was reversed — check whether the balance still stands' }

  if (journal.lines.some(l => startsWithCode(l.accountLabel, OPENING_BALANCE_EQUITY_CODE))) {
    return { action: 'ok', reason: 'Already posted to Opening Balance Equity' }
  }
  const profitAndLoss = journal.lines.filter(l => l.accountType === 'revenue' || l.accountType === 'expense')
  if (!profitAndLoss.length) return { action: 'review', reason: 'Journal has no revenue or expense line to move' }
  const unknown = journal.lines.filter(l => !l.accountType)
  if (unknown.length) return { action: 'review', reason: `Account type unknown for ${unknown.map(l => l.accountLabel).join(', ')}` }
  const hasVat = journal.lines.some(l => /vat/i.test(l.accountLabel))
  if (hasVat) return { action: 'review', reason: 'Journal includes VAT — an opening balance should carry none' }

  // Reverse each revenue/expense line and put the net on 4004.
  const reversed = profitAndLoss.map(l => ({
    accountLabel: l.accountLabel,
    label: `Opening balance ${doc.ref}: move out of ${l.accountType}`,
    debit: money(l.credit),
    credit: money(l.debit),
  }))
  const net = money(reversed.reduce((s, l) => s + l.debit - l.credit, 0))
  const equity: JournalLineDraft = net >= 0
    ? { accountLabel: OPENING_BALANCE_EQUITY_LABEL, label: `Opening balance ${doc.ref}`, debit: 0, credit: net }
    : { accountLabel: OPENING_BALANCE_EQUITY_LABEL, label: `Opening balance ${doc.ref}`, debit: -net, credit: 0 }
  return {
    action: 'reclass',
    reason: `Posted to ${profitAndLoss.map(l => l.accountLabel).join(', ')} — moving it to Opening Balance Equity`,
    lines: [...reversed, equity],
  }
}

/** Reference of the correcting journal (idempotent: one per document). */
export function openingBalanceCorrectionRef(ref: string, action: 'post' | 'reclass'): string {
  return `${action === 'post' ? 'JRN/OB/' : 'JRN/OBFIX/'}${ref}`.slice(0, 80)
}

// ── Repairs for documents from the first importer ──────────────────────────

type MigratedDoc = {
  id?: unknown
  type?: unknown
  ref?: unknown
  partnerName?: unknown
  total?: unknown
  amountPaid?: unknown
  date?: unknown
  dueDate?: unknown
}

/**
 * The first importer saved each document before posting journals for the
 * whole ledger, timed out, reported "Migration import failed" — and every
 * retry saved the file again. Copies share kind, partner, reference and
 * amount. The first copy (or one already in the ledger) is kept; the others
 * may be removed only if nothing was paid against them and they never
 * reached the ledger.
 */
export function findDuplicateOpeningBalances(
  docs: MigratedDoc[],
  inLedger: (id: string) => boolean,
): { remove: Map<string, string>; blocked: Map<string, string> } {
  const groups = new Map<string, MigratedDoc[]>()
  for (const doc of docs) {
    const key = [
      String(doc.type ?? ''),
      String(doc.partnerName ?? '').trim().toLowerCase(),
      String(doc.ref ?? '').trim().toLowerCase(),
      Math.round(Number(doc.total) || 0),
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), doc])
  }
  const remove = new Map<string, string>()
  const blocked = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const keeper = group.find(d => inLedger(String(d.id))) ?? group[0]
    for (const doc of group) {
      if (doc === keeper) continue
      const id = String(doc.id)
      if ((Number(doc.amountPaid) || 0) > 0) blocked.set(id, `Duplicate of ${String(keeper.ref ?? '')}, but has payments recorded`)
      else if (inLedger(id)) blocked.set(id, `Duplicate of ${String(keeper.ref ?? '')}, but already in the ledger`)
      else remove.set(id, String(keeper.id))
    }
  }
  return { remove, blocked }
}

/**
 * A date the first importer stored as Excel's day number ("46326" — shown as
 * the year 46326). Returns the real date, or null when the value is fine.
 */
export function repairedMigratedDate(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{5}(\.\d+)?$/.test(raw)) return null
  const serial = Math.floor(Number(raw))
  if (serial < 20000 || serial > 80000) return null
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10)
}
