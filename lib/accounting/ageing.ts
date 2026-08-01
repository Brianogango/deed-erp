/**
 * Aged receivables / payables helpers.
 * Buckets open invoice residuals by days past due (as-of date).
 */

export type AgeingBucketKey = 'current' | 'd30' | 'd60' | 'd90' | 'over90'

export interface AgeingInvoiceLike {
  id: string
  ref: string
  partnerId?: string
  partnerName: string
  type?: string
  status?: string
  date: string
  dueDate?: string
  total: number
  amountPaid: number
}

export interface AgeingRow {
  id: string
  ref: string
  partnerId?: string
  partnerName: string
  dueDate: string
  daysPastDue: number
  balance: number
  current: number
  d30: number
  d60: number
  d90: number
  over90: number
  bucket: AgeingBucketKey
}

export interface AgeingTotals {
  balance: number
  current: number
  d30: number
  d60: number
  d90: number
  over90: number
}

export interface AgeingPartnerRow {
  partnerId: string
  partnerName: string
  invoiceCount: number
  balance: number
  current: number
  d30: number
  d60: number
  d90: number
  over90: number
  invoiceIds: string[]
}

export interface AgeingReport {
  rows: AgeingRow[]
  totals: AgeingTotals
  partners: AgeingPartnerRow[]
}

const emptyTotals = (): AgeingTotals => ({
  balance: 0, current: 0, d30: 0, d60: 0, d90: 0, over90: 0,
})

function parseDay(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? fallback : d
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function invoiceOpenBalance(inv: AgeingInvoiceLike): number {
  return Math.max(0, Number(inv.total || 0) - Number(inv.amountPaid || 0))
}

export function isOpenForAgeing(inv: AgeingInvoiceLike): boolean {
  if (String(inv.status || '').toLowerCase() === 'cancelled') return false
  if (String(inv.status || '').toLowerCase() === 'draft') return false
  return invoiceOpenBalance(inv) > 0.0001
}

export function daysPastDue(dueOrInvoiceDate: string, asOf: Date = new Date()): number {
  const due = startOfLocalDay(parseDay(dueOrInvoiceDate, asOf))
  const asOfDay = startOfLocalDay(asOf)
  return Math.max(0, Math.floor((asOfDay.getTime() - due.getTime()) / 86400000))
}

export function bucketForDays(days: number): AgeingBucketKey {
  if (days <= 0) return 'current'
  if (days <= 30) return 'd30'
  if (days <= 60) return 'd60'
  if (days <= 90) return 'd90'
  return 'over90'
}

export function bucketOpenInvoices(
  items: AgeingInvoiceLike[],
  asOf: Date | string = new Date(),
): AgeingReport {
  const asOfDate = typeof asOf === 'string' ? parseDay(asOf, new Date()) : asOf
  const rows: AgeingRow[] = items
    .filter(isOpenForAgeing)
    .map(inv => {
      const dueDate = inv.dueDate || inv.date
      const days = daysPastDue(dueDate, asOfDate)
      const balance = invoiceOpenBalance(inv)
      const bucket = bucketForDays(days)
      return {
        id: inv.id,
        ref: inv.ref,
        partnerId: inv.partnerId,
        partnerName: inv.partnerName || 'Unknown',
        dueDate,
        daysPastDue: days,
        balance,
        current: bucket === 'current' ? balance : 0,
        d30: bucket === 'd30' ? balance : 0,
        d60: bucket === 'd60' ? balance : 0,
        d90: bucket === 'd90' ? balance : 0,
        over90: bucket === 'over90' ? balance : 0,
        bucket,
      }
    })
    .sort((a, b) => b.daysPastDue - a.daysPastDue || b.balance - a.balance)

  const totals = rows.reduce((a, r) => ({
    balance: a.balance + r.balance,
    current: a.current + r.current,
    d30: a.d30 + r.d30,
    d60: a.d60 + r.d60,
    d90: a.d90 + r.d90,
    over90: a.over90 + r.over90,
  }), emptyTotals())

  const byPartner = new Map<string, AgeingPartnerRow>()
  for (const row of rows) {
    const key = row.partnerId || row.partnerName
    const existing = byPartner.get(key)
    if (!existing) {
      byPartner.set(key, {
        partnerId: key,
        partnerName: row.partnerName,
        invoiceCount: 1,
        balance: row.balance,
        current: row.current,
        d30: row.d30,
        d60: row.d60,
        d90: row.d90,
        over90: row.over90,
        invoiceIds: [row.id],
      })
    } else {
      existing.invoiceCount += 1
      existing.balance += row.balance
      existing.current += row.current
      existing.d30 += row.d30
      existing.d60 += row.d60
      existing.d90 += row.d90
      existing.over90 += row.over90
      existing.invoiceIds.push(row.id)
    }
  }

  const partners = [...byPartner.values()].sort((a, b) => b.balance - a.balance)

  return { rows, totals, partners }
}
