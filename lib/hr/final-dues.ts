/**
 * Final dues on exit. Pure calculation so it can be unit-tested and reused by
 * the statement PDF. The statutory deductions use the same engine as monthly
 * payroll, treating the terminal payment as one month's taxable pay, so the net
 * is an ESTIMATE until the accountant confirms the PAYE treatment of notice
 * and leave pay.
 */
import { calculateKenyaPayroll, money } from '@/lib/hr/kenya-payroll'

export interface FinalDuesInput {
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  /** ISO date of the last working day. */
  exitDate: string
  /** Unused annual leave days at exit. */
  unusedLeaveDays: number
  /** Notice days paid in lieu (0 if notice was worked). */
  noticePayDays: number
  /** Skip the pro-rata salary when the exit month was already paid through payroll. */
  exitMonthSalaryPaid: boolean
  outstandingLoans: number
  outstandingAdvances: number
  /** Value of company assets not returned, deducted when HR decides to recover it. */
  unreturnedAssetsCharge: number
  otherDeductions: number
}

export interface FinalDuesStatement {
  daysWorkedInExitMonth: number
  daysInExitMonth: number
  dailyRate: number
  earnings: Array<{ label: string; amount: number }>
  gross: number
  statutory: Array<{ label: string; amount: number }>
  recoveries: Array<{ label: string; amount: number }>
  totalDeductions: number
  net: number
}

export function calculateFinalDues(i: FinalDuesInput): FinalDuesStatement {
  const exit = new Date(`${i.exitDate}T00:00:00Z`)
  const year = exit.getUTCFullYear()
  const month = exit.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const worked = Math.min(daysInMonth, Math.max(0, exit.getUTCDate()))

  const monthlyGross = money(i.basicSalary + i.housingAllowance + i.transportAllowance)
  // Employment Act: a day's wage is 1/30 of the monthly wage (basic) for leave and notice.
  const dailyRate = money(i.basicSalary / 30)
  const prorata = i.exitMonthSalaryPaid ? 0 : money((monthlyGross * worked) / daysInMonth)
  const leavePay = money(Math.max(0, i.unusedLeaveDays) * dailyRate)
  const noticePay = money(Math.max(0, i.noticePayDays) * dailyRate)

  const earnings = [
    ...(prorata > 0 ? [{ label: `Salary for ${worked} of ${daysInMonth} days`, amount: prorata }] : []),
    ...(leavePay > 0 ? [{ label: `Unused leave (${i.unusedLeaveDays} days)`, amount: leavePay }] : []),
    ...(noticePay > 0 ? [{ label: `Notice pay in lieu (${i.noticePayDays} days)`, amount: noticePay }] : []),
  ]
  const gross = money(earnings.reduce((s, e) => s + e.amount, 0))

  const calc = gross > 0
    ? calculateKenyaPayroll(gross, 0, 0)
    : null
  const statutory = calc
    ? [
        { label: 'PAYE (after personal relief)', amount: calc.paye },
        { label: 'NSSF', amount: calc.nssf },
        { label: 'SHIF', amount: calc.shif },
        { label: 'Affordable Housing Levy', amount: calc.housingLevy },
      ].filter(r => r.amount > 0)
    : []

  const recoveries = [
    { label: 'Outstanding staff loan', amount: money(i.outstandingLoans) },
    { label: 'Outstanding salary advance', amount: money(i.outstandingAdvances) },
    { label: 'Unreturned company assets', amount: money(i.unreturnedAssetsCharge) },
    { label: 'Other deductions', amount: money(i.otherDeductions) },
  ].filter(r => r.amount > 0)

  const totalDeductions = money(
    statutory.reduce((s, r) => s + r.amount, 0) + recoveries.reduce((s, r) => s + r.amount, 0),
  )
  return {
    daysWorkedInExitMonth: worked,
    daysInExitMonth: daysInMonth,
    dailyRate,
    earnings,
    gross,
    statutory,
    recoveries,
    totalDeductions,
    // Negative means the employee owes the company.
    net: money(gross - totalDeductions),
  }
}
