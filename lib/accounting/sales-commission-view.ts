/**
 * Read-model helpers for posted sales commission rows.
 * Earned when a customer invoice is posted — not on quote/SO, not on payment.
 */

export type CommissionRowView = {
  id: string
  employeeId: string
  employeeName: string
  invoiceId?: string
  invoiceRef?: string
  periodMonth: number
  periodYear: number
  saleAmount: number
  commissionRate: number
  commissionAmount: number
  isPaid: boolean
  createdAt?: string
}

export type CommissionEmployeeSummary = {
  employeeId: string
  employeeName: string
  saleAmount: number
  commissionAmount: number
  accrued: number
  paid: number
  lines: number
}

export type CommissionPeriodSummary = {
  saleAmount: number
  commissionAmount: number
  accrued: number
  paid: number
  byEmployee: CommissionEmployeeSummary[]
}

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function summarizeCommissions(rows: readonly CommissionRowView[]): CommissionPeriodSummary {
  const byId = new Map<string, CommissionEmployeeSummary>()
  let saleAmount = 0
  let commissionAmount = 0
  let accrued = 0
  let paid = 0

  for (const row of rows) {
    const sale = money(row.saleAmount)
    const commission = money(row.commissionAmount)
    saleAmount += sale
    commissionAmount += commission
    if (row.isPaid) paid += commission
    else accrued += commission

    const existing = byId.get(row.employeeId)
    if (existing) {
      existing.saleAmount = money(existing.saleAmount + sale)
      existing.commissionAmount = money(existing.commissionAmount + commission)
      existing.accrued = money(existing.accrued + (row.isPaid ? 0 : commission))
      existing.paid = money(existing.paid + (row.isPaid ? commission : 0))
      existing.lines += 1
    } else {
      byId.set(row.employeeId, {
        employeeId: row.employeeId,
        employeeName: row.employeeName || row.employeeId,
        saleAmount: sale,
        commissionAmount: commission,
        accrued: row.isPaid ? 0 : commission,
        paid: row.isPaid ? commission : 0,
        lines: 1,
      })
    }
  }

  return {
    saleAmount: money(saleAmount),
    commissionAmount: money(commissionAmount),
    accrued: money(accrued),
    paid: money(paid),
    byEmployee: [...byId.values()].sort((a, b) => b.commissionAmount - a.commissionAmount),
  }
}

export function monthsInQuarter(year: number, quarter: number): Array<{ year: number; month: number }> {
  const q = Math.min(4, Math.max(1, quarter))
  const start = (q - 1) * 3 + 1
  return [start, start + 1, start + 2].map(month => ({ year, month }))
}

/** Dashboard period keys: `2026-08` (calendar month) or `2026-Q3`. Months are 1–12. */
export function periodMonthsFromKey(key: string): Array<{ year: number; month: number }> {
  const quarter = key.match(/^(\d{4})-Q([1-4])$/)
  if (quarter) return monthsInQuarter(Number(quarter[1]), Number(quarter[2]))
  const month = key.match(/^(\d{4})-(\d{2})$/)
  if (month) return [{ year: Number(month[1]), month: Number(month[2]) }]
  return []
}
