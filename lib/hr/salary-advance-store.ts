import 'server-only'
import type { SalaryAdvance } from '@/lib/store'

// Translate between the Prisma salary_advances row and the client SalaryAdvance
// JSON shape so the dedicated API can back the client without changing it.

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined)
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : undefined)

export function toClientAdvance(a: any): SalaryAdvance {
  return {
    id: a.id,
    ref: a.reference ?? `ADV/${a.id.slice(0, 8).toUpperCase()}`,
    employeeId: a.employeeId,
    employeeName: a.employeeName ?? '',
    amount: num(a.amount),
    paymentTerms: (a.paymentTerms as SalaryAdvance['paymentTerms']) ?? 'payroll_deduction',
    repaymentMonths: num(a.repaymentMonths) || 1,
    repaymentStartPeriod: a.repaymentStartPeriod ?? '',
    monthlyDeduction: num(a.monthlyDeduction),
    amountRecovered: num(a.amountRecovered),
    outstandingAmount: num(a.outstandingAmount),
    deductions: Array.isArray(a.deductions) ? a.deductions : [],
    reason: a.reason ?? '',
    status: (a.status as SalaryAdvance['status']) ?? 'pending',
    requestedDate: iso(a.requestedDate) ?? new Date().toISOString(),
    neededByDate: dateOnly(a.neededByDate),
    approvedByUserId: a.approvedByUserId ?? undefined,
    approvedByName: a.approvedByName ?? undefined,
    decisionDate: iso(a.decisionDate),
    decisionNote: a.decisionNote ?? undefined,
    paidDate: dateOnly(a.paidDate),
    createdByUserId: a.createdByUserId ?? undefined,
  }
}

// Build a Prisma data object from a (partial) client advance. Only defined keys
// are included so it works for both create and update.
export function toDbAdvance(a: Partial<SalaryAdvance>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (a.id !== undefined && a.id) data.id = a.id
  if (a.ref !== undefined) data.reference = a.ref
  if (a.employeeId !== undefined) data.employeeId = a.employeeId
  if (a.employeeName !== undefined) data.employeeName = a.employeeName
  if (a.amount !== undefined) data.amount = num(a.amount)
  if (a.paymentTerms !== undefined) data.paymentTerms = a.paymentTerms
  if (a.repaymentMonths !== undefined) data.repaymentMonths = num(a.repaymentMonths) || 1
  if (a.repaymentStartPeriod !== undefined) data.repaymentStartPeriod = a.repaymentStartPeriod || null
  if (a.monthlyDeduction !== undefined) data.monthlyDeduction = num(a.monthlyDeduction)
  if (a.amountRecovered !== undefined) data.amountRecovered = num(a.amountRecovered)
  if (a.outstandingAmount !== undefined) data.outstandingAmount = num(a.outstandingAmount)
  if (a.deductions !== undefined) data.deductions = a.deductions ?? []
  if (a.reason !== undefined) data.reason = a.reason || null
  if (a.status !== undefined) data.status = a.status
  if (a.neededByDate !== undefined) data.neededByDate = a.neededByDate ? new Date(a.neededByDate) : null
  if (a.approvedByUserId !== undefined) data.approvedByUserId = a.approvedByUserId || null
  if (a.approvedByName !== undefined) data.approvedByName = a.approvedByName || null
  if (a.decisionDate !== undefined) data.decisionDate = a.decisionDate ? new Date(a.decisionDate) : null
  if (a.decisionNote !== undefined) data.decisionNote = a.decisionNote || null
  if (a.paidDate !== undefined) data.paidDate = a.paidDate ? new Date(a.paidDate) : null
  if (a.createdByUserId !== undefined) data.createdByUserId = a.createdByUserId || null
  return data
}
