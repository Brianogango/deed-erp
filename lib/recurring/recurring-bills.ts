/**
 * Recurring vendor bills (rent, service charge, electricity, water…).
 *
 * A template describes a bill that arrives every period. It never posts
 * anything itself: each period Finance generates a DRAFT vendor bill from it
 * and posts it after checking it against the vendor's invoice.
 */
import { roundMoney } from '@/lib/accounting/money'
import { dueDateFromTerms } from '@/lib/due-date'

export type Frequency = 'monthly' | 'quarterly' | 'yearly'

export type RecurringLine = {
  description: string
  /** Operating-expense account (6xxx). Empty = Purchases default. */
  accountCode?: string
  /** Fixed amount, or null when it changes each period (electricity, water). */
  amount: number | null
}

export type GeneratedBill = { period: string; invoiceId: string; invoiceRef: string; billDate: string }

export type RecurringBill = {
  id: string
  ref: string                 // RB/0001
  vendorId: string
  vendorName: string
  title: string
  frequency: Frequency
  dayOfMonth: number          // 1–31, clamped to the month's length
  startDate: string           // YYYY-MM-DD
  endDate?: string
  vatRate: number             // 0 or e.g. 16, applied to every line
  lines: RecurringLine[]
  paused: boolean
  notes?: string
  generated: GeneratedBill[]
  createdAt: string
  createdBy?: string
}

const MONTH_STEP: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 }
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(date: string): [number, number, number] | null {
  const m = ISO.exec(String(date ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate() }
function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The label that makes one period unique: 2026-10 · 2026-Q4 · 2026. */
export function periodKey(billDate: string, frequency: Frequency): string {
  const p = parts(billDate)
  if (!p) return ''
  if (frequency === 'yearly') return String(p[0])
  if (frequency === 'quarterly') return `${p[0]}-Q${Math.floor((p[1] - 1) / 3) + 1}`
  return `${p[0]}-${String(p[1]).padStart(2, '0')}`
}

export function isVariable(t: Pick<RecurringBill, 'lines'>): boolean {
  return t.lines.some(l => l.amount == null)
}

/** All bill dates of the template up to `asOf` (and `endDate`), oldest first. */
export function occurrenceDates(t: Pick<RecurringBill, 'frequency' | 'dayOfMonth' | 'startDate' | 'endDate'>, asOf: string): string[] {
  const start = parts(t.startDate)
  const limit = parts(asOf)
  if (!start || !limit) return []
  const end = t.endDate ? parts(t.endDate) : null
  const out: string[] = []
  let y = start[0]
  let m = start[1]
  for (let guard = 0; guard < 600; guard++) {
    const d = iso(y, m, Math.min(Math.max(1, t.dayOfMonth), daysInMonth(y, m)))
    if (d > asOf || (end && d > iso(end[0], end[1], end[2]))) break
    if (d >= t.startDate) out.push(d)
    m += MONTH_STEP[t.frequency]
    while (m > 12) { m -= 12; y += 1 }
  }
  return out
}

/** Bill dates that have arrived but have no bill yet. Paused templates have none. */
export function dueOccurrences(t: RecurringBill, asOf: string, cap = 12): string[] {
  if (t.paused) return []
  const done = new Set(t.generated.map(g => g.period))
  return occurrenceDates(t, asOf).filter(d => !done.has(periodKey(d, t.frequency))).slice(0, cap)
}

export function nextRecurringRef(items: Pick<RecurringBill, 'ref'>[]): string {
  const max = items.reduce((m, i) => {
    const n = parseInt(String(i.ref).replace(/^RB\//, ''), 10)
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  return `RB/${String(max + 1).padStart(4, '0')}`
}

export function validateTemplate(input: Partial<RecurringBill>): string | null {
  if (!String(input.vendorId ?? '').trim()) return 'Choose the vendor'
  if (!String(input.title ?? '').trim()) return 'Give the bill a name, e.g. "Office rent"'
  if (!['monthly', 'quarterly', 'yearly'].includes(String(input.frequency))) return 'Choose how often it repeats'
  const day = Number(input.dayOfMonth)
  if (!Number.isInteger(day) || day < 1 || day > 31) return 'Day of the month must be 1–31'
  if (!ISO.test(String(input.startDate ?? ''))) return 'Start date is required'
  if (input.endDate && (!ISO.test(input.endDate) || input.endDate < String(input.startDate))) return 'End date must be after the start date'
  const vat = Number(input.vatRate ?? 0)
  if (!(vat >= 0 && vat <= 100)) return 'VAT rate must be 0–100'
  const lines = input.lines ?? []
  if (lines.length === 0) return 'Add at least one line'
  for (const l of lines) {
    if (!String(l.description ?? '').trim()) return 'Every line needs a description'
    if (l.amount != null && !(roundMoney(l.amount) > 0)) return 'A fixed amount must be greater than zero (leave it blank if it changes each period)'
  }
  return null
}

type BillInput = {
  billDate: string
  dueDate: string
  period: string
  vatRate: number
  notes: string
  lines: { type: 'item'; desc: string; qty: string; price: string; tax: string; discount: string; account: string }[]
}

/**
 * The draft vendor bill for one period. `variableAmounts` is keyed by line
 * index and must supply every line whose template amount is blank.
 */
export function buildBillInput(
  t: RecurringBill,
  billDate: string,
  variableAmounts: Record<number, number>,
  vendorTermsDays: number,
): BillInput | { error: string } {
  const lines: BillInput['lines'] = []
  for (let i = 0; i < t.lines.length; i++) {
    const l = t.lines[i]
    const amount = l.amount != null ? l.amount : variableAmounts[i]
    if (!(roundMoney(amount) > 0)) return { error: `Enter the amount for "${l.description}"` }
    lines.push({
      type: 'item', desc: l.description, qty: '1', price: String(roundMoney(amount)),
      tax: '0', discount: '0', account: l.accountCode ?? '',
    })
  }
  const period = periodKey(billDate, t.frequency)
  return {
    billDate,
    dueDate: dueDateFromTerms(billDate, vendorTermsDays),
    period,
    vatRate: t.vatRate,
    notes: `Recurring ${t.ref} — ${t.title} (${period})`,
    lines,
  }
}
