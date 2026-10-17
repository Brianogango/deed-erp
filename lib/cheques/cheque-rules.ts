/**
 * Cheque register rules — pure, shared by the API, the notification scan and
 * the Finance → Banking → Cheques tab.
 *
 * A cheque is either `received` (a customer paid us by cheque) or `given`
 * (we paid a supplier by cheque). The date written on the cheque is the day it
 * can be banked (received) or presented against our account (given).
 */

export type ChequeDirection = 'received' | 'given'
export type ChequeStatus = 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled'

export const CHEQUE_DIRECTIONS: ChequeDirection[] = ['received', 'given']
export const CHEQUE_STATUSES: ChequeStatus[] = ['pending', 'deposited', 'cleared', 'bounced', 'cancelled']

/** Roles that can see and work the register (and receive its reminders). */
export const CHEQUE_ROLES = ['director', 'admin_officer', 'finance_officer'] as const

/** In Kenya a cheque is stale six months after the date written on it. */
export const CHEQUE_STALE_MONTHS = 6

export const STATUS_LABEL: Record<ChequeDirection, Record<ChequeStatus, string>> = {
  received: { pending: 'Held', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled' },
  given: { pending: 'Issued', deposited: 'Presented', cleared: 'Cleared', bounced: 'Returned', cancelled: 'Stopped' },
}

/** Statuses a cheque can move to from its current one. */
export const NEXT_STATUSES: Record<ChequeStatus, ChequeStatus[]> = {
  pending: ['deposited', 'cleared', 'bounced', 'cancelled'],
  deposited: ['cleared', 'bounced', 'cancelled'],
  cleared: [],
  bounced: ['pending'],
  cancelled: ['pending'],
}

export function canMoveTo(from: ChequeStatus, to: ChequeStatus): boolean {
  return NEXT_STATUSES[from]?.includes(to) ?? false
}

/** A cheque still waiting on someone: not banked/presented, not closed. */
export function isOpenCheque(status: ChequeStatus): boolean {
  return status === 'pending'
}

const DAY_MS = 86_400_000

/** Whole days from `today` to `date` (both YYYY-MM-DD). Negative when the date has passed. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${date}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((a - b) / DAY_MS)
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.toISOString().slice(0, 10)
}

export function isStaleCheque(chequeDate: string, today: string): boolean {
  return today > addMonths(chequeDate, CHEQUE_STALE_MONTHS)
}

export type ChequeAlert = 'due_tomorrow' | 'due_today' | 'overdue' | 'stale' | null

/** Where an open cheque stands against today's date. Closed cheques never alert. */
export function chequeAlert(cheque: { status: ChequeStatus; chequeDate: string }, today: string): ChequeAlert {
  if (!isOpenCheque(cheque.status)) return null
  if (isStaleCheque(cheque.chequeDate, today)) return 'stale'
  const days = daysUntil(cheque.chequeDate, today)
  if (days === 1) return 'due_tomorrow'
  if (days === 0) return 'due_today'
  if (days < 0) return 'overdue'
  return null
}

export function alertLabel(direction: ChequeDirection, alert: ChequeAlert, chequeDate: string, today: string): string {
  const days = daysUntil(chequeDate, today)
  switch (alert) {
    case 'due_tomorrow': return direction === 'received' ? 'Ready for banking tomorrow' : 'Due tomorrow'
    case 'due_today': return direction === 'received' ? 'Ready for banking today' : 'Due today'
    case 'overdue': return direction === 'received' ? `Not banked — ${-days} day${-days === 1 ? '' : 's'} past its date` : `${-days} day${-days === 1 ? '' : 's'} past its date`
    case 'stale': return 'Stale — over 6 months old'
    default: return days > 1 ? `In ${days} days` : ''
  }
}

export interface DigestCheque {
  id: string
  direction: ChequeDirection
  status: ChequeStatus
  chequeNumber: string
  partyName: string
  amount: number
  chequeDate: string
}

export interface ChequeDigests {
  dueTomorrow: Array<{ id: string; line: string }>
  readyForBanking: Array<{ id: string; line: string }>
  givenDue: Array<{ id: string; line: string }>
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`

/**
 * Splits the open cheques into the three daily reminders:
 *  - due tomorrow (either direction) — the day-before heads-up,
 *  - ready for banking — received cheques whose date has come (today or earlier),
 *  - given cheques due — cheques we issued whose date has come, so the account
 *    must hold the money.
 * Stale cheques are left out of the banking list: the bank will refuse them.
 */
export function buildChequeDigests(cheques: DigestCheque[], today: string): ChequeDigests {
  const out: ChequeDigests = { dueTomorrow: [], readyForBanking: [], givenDue: [] }
  const sorted = [...cheques].sort((a, b) => a.chequeDate.localeCompare(b.chequeDate))
  for (const c of sorted) {
    const alert = chequeAlert(c, today)
    if (!alert) continue
    const who = c.partyName || (c.direction === 'received' ? 'customer' : 'supplier')
    if (alert === 'due_tomorrow') {
      const verb = c.direction === 'received' ? 'ready for banking tomorrow' : 'falls due tomorrow'
      out.dueTomorrow.push({ id: c.id, line: `${c.direction === 'received' ? 'Received' : 'Given'} cheque ${c.chequeNumber} — ${kes(c.amount)} ${c.direction === 'received' ? 'from' : 'to'} ${who}, ${verb}` })
      continue
    }
    if (alert === 'stale') continue
    const late = alert === 'overdue' ? ` (dated ${c.chequeDate})` : ''
    if (c.direction === 'received') {
      out.readyForBanking.push({ id: c.id, line: `Cheque ${c.chequeNumber} — ${kes(c.amount)} from ${who}${late}` })
    } else {
      out.givenDue.push({ id: c.id, line: `Cheque ${c.chequeNumber} — ${kes(c.amount)} to ${who}${late}` })
    }
  }
  return out
}

export interface ChequeInput {
  direction: ChequeDirection
  chequeNumber: string
  bankName: string
  partyName: string
  amount: number
  chequeDate: string
  receivedDate?: string
}

/** Returns an error message, or null when the cheque is acceptable to save. */
export function validateChequeInput(input: Partial<ChequeInput>): string | null {
  if (!input.direction || !CHEQUE_DIRECTIONS.includes(input.direction)) return 'Choose whether the cheque was received or given'
  if (!String(input.chequeNumber ?? '').trim()) return 'Enter the cheque number'
  if (!String(input.partyName ?? '').trim()) return input.direction === 'received' ? 'Enter who the cheque is from' : 'Enter who the cheque is paid to'
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter the cheque amount'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.chequeDate ?? '')) || Number.isNaN(Date.parse(`${input.chequeDate}T00:00:00Z`))) return 'Enter the date written on the cheque'
  return null
}

/**
 * Cheques are written as 05/10/2026, 5-10-26, 5 Oct 2026 or already as
 * 2026-10-05. Day comes first (Kenya). Returns YYYY-MM-DD, or '' when unclear.
 */
export function normalizeChequeDate(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  const dmy = /^(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{2}|\d{4})$/.exec(text)
  const named = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2}|\d{4})$/.exec(text)
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3] }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3] }
  else if (named) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const idx = months.indexOf(named[2].slice(0, 3).toLowerCase())
    if (idx < 0) return ''
    d = +named[1]; m = idx + 1; y = +named[3]
  } else return ''
  if (y < 100) y += 2000
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return ''
  return date.toISOString().slice(0, 10)
}
