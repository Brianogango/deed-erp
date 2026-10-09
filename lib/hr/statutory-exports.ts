/**
 * Pure builders for the monthly statutory schedules and the salary payment
 * files, from the rows returned by GET /api/payroll/[id]/statutory.
 * Layouts follow the common KRA iTax, NSSF and SHA upload templates; confirm
 * the column order against the current portal template before the first upload.
 */
import type { StatutoryReport, StatutoryRow, AnnualEmployeeRow } from '@/lib/hr/payroll-report-types'

export type CsvTable = { headers: string[]; rows: Array<Array<string | number>>; filename: string }

type Row = StatutoryRow
const m2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const tag = (r: StatutoryReport) => `${r.run.year}-${String(r.run.month).padStart(2, '0')}`

/** KRA P10 / iTax PAYE monthly return (one line per employee). */
export function buildPayeReturn(report: StatutoryReport, residentOverride?: (r: Row) => boolean): CsvTable {
  const headers = [
    'PIN of Employee', 'Name of Employee', 'Residential Status', 'Type of Employee',
    'Basic Salary', 'Housing Allowance', 'Transport Allowance', 'Leave Pass', 'Overtime',
    'Directors Fee', 'Lump Sum Payment', 'Other Allowances', 'Total Cash Pay',
    'Value of Car Benefit', 'Other Non Cash Benefits', 'Total Non Cash Pay', 'Global Income',
    'Type of Housing', 'Rent of House / Market Value', 'Computed Rent', 'Rent Recovered', 'Net Value of Housing',
    'Total Gross Pay', '30% of Cash Pay', 'Actual Contribution', 'Permissible Limit',
    'Mortgage Interest', 'Deposit on Home Ownership', 'Amount of Benefit', 'Taxable Pay',
    'Tax Payable', 'Monthly Personal Relief', 'Insurance Relief', 'PAYE Tax', 'Self Assessed PAYE Tax',
  ]
  const rows = report.rows.map(r => {
    const resident = residentOverride ? residentOverride(r) : true
    const otherAllowances = m2(r.commission + r.otherAdditions)
    const cash = m2(r.gross)
    const deductible = m2(r.nssf + r.shif + r.housingLevy + r.pension)
    const taxable = Math.max(0, m2(cash - deductible))
    return [
      r.kraPin, r.employeeName, resident ? 'Resident' : 'Non-Resident', 'Primary Employee',
      m2(r.basic), m2(r.housingAllowance), m2(r.transportAllowance), 0, m2(r.overtimePay),
      0, 0, otherAllowances, cash,
      0, 0, 0, cash,
      'Benefit not given', 0, 0, 0, 0,
      cash, m2(cash * 0.3), m2(r.nssf + r.pension), 30000,
      0, 0, deductible, taxable,
      m2(r.paye + r.personalRelief), m2(r.personalRelief), 0, m2(r.paye), m2(r.paye),
    ]
  })
  return { headers, rows, filename: `PAYE-return-${tag(report)}` }
}

/** NSSF employer contribution upload (employee + employer, tiers combined). */
export function buildNssfReturn(report: StatutoryReport): CsvTable {
  const headers = ['Payroll Number', 'Surname', 'Other Names', 'ID Number', 'KRA PIN', 'NSSF Number', 'Gross Pay', 'Voluntary Contribution', 'Employee Contribution', 'Employer Contribution', 'Total Contribution']
  const rows = report.rows.map(r => [
    r.employeeNo, r.lastName, r.firstName, r.idNumber, r.kraPin, r.nssfNumber,
    m2(r.gross), 0, m2(r.nssf), m2(r.employerNssf), m2(r.nssf + r.employerNssf),
  ])
  return { headers, rows, filename: `NSSF-schedule-${tag(report)}` }
}

/** SHA (SHIF) contribution schedule. */
export function buildShifReturn(report: StatutoryReport): CsvTable {
  const headers = ['Payroll Number', 'Name', 'ID Number', 'KRA PIN', 'SHA Number', 'Gross Pay', 'SHIF Contribution']
  const rows = report.rows.map(r => [r.employeeNo, r.employeeName, r.idNumber, r.kraPin, r.shaNumber, m2(r.gross), m2(r.shif)])
  return { headers, rows, filename: `SHIF-schedule-${tag(report)}` }
}

/** Affordable Housing Levy schedule (employee + employer share). */
export function buildHousingLevyReturn(report: StatutoryReport): CsvTable {
  const headers = ['Payroll Number', 'Name', 'ID Number', 'KRA PIN', 'Gross Pay', 'Employee Levy', 'Employer Levy', 'Total Levy']
  const rows = report.rows.map(r => [
    r.employeeNo, r.employeeName, r.idNumber, r.kraPin, m2(r.gross),
    m2(r.housingLevy), m2(r.employerHousingLevy), m2(r.housingLevy + r.employerHousingLevy),
  ])
  return { headers, rows, filename: `Housing-levy-schedule-${tag(report)}` }
}

/** Salary payment file for staff paid into a bank account. */
export function buildBankPaymentFile(report: StatutoryReport): CsvTable & { skipped: string[] } {
  const skipped: string[] = []
  const rows: Array<Array<string | number>> = []
  for (const r of report.rows) {
    if (r.paymentMode === 'mpesa' || r.net <= 0) continue
    if (!r.bankAccount) { skipped.push(`${r.employeeName} (no bank account)`); continue }
    rows.push([r.employeeNo, r.employeeName, r.bankName, r.bankAccount, m2(r.net), `Salary ${report.run.month}/${report.run.year}`])
  }
  return {
    headers: ['Employee No', 'Account Name', 'Bank', 'Account Number', 'Amount', 'Narration'],
    rows, skipped, filename: `Salary-bank-file-${tag(report)}`,
  }
}

/** Salary payment file for staff paid by M-Pesa (B2C bulk upload). */
export function buildMpesaPaymentFile(report: StatutoryReport): CsvTable & { skipped: string[] } {
  const skipped: string[] = []
  const rows: Array<Array<string | number>> = []
  for (const r of report.rows) {
    if (r.paymentMode !== 'mpesa' || r.net <= 0) continue
    const phone = normalizeKenyanMsisdn(r.mpesaNumber)
    if (!phone) { skipped.push(`${r.employeeName} (no valid M-Pesa number)`); continue }
    rows.push([phone, m2(r.net), r.employeeName, `Salary ${report.run.month}/${report.run.year}`])
  }
  return {
    headers: ['Phone Number', 'Amount', 'Name', 'Reference'],
    rows, skipped, filename: `Salary-mpesa-file-${tag(report)}`,
  }
}

export function normalizeKenyanMsisdn(raw: string): string | null {
  const digits = String(raw ?? '').replace(/[^\d]/g, '')
  if (/^2547\d{8}$/.test(digits) || /^2541\d{8}$/.test(digits)) return digits
  if (/^07\d{8}$/.test(digits) || /^01\d{8}$/.test(digits)) return `254${digits.slice(1)}`
  if (/^7\d{8}$/.test(digits) || /^1\d{8}$/.test(digits)) return `254${digits}`
  return null
}

/** P9 (tax deduction card) rows for a single employee, with an annual total row. */
export function buildP9(emp: AnnualEmployeeRow, year: number): CsvTable {
  const headers = ['Month', 'Basic Salary', 'Benefits / Allowances', 'Gross Pay', 'NSSF', 'SHIF', 'Housing Levy', 'Pension', 'Taxable Pay', 'Tax Charged', 'Personal Relief', 'PAYE Deducted']
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const rows = emp.months.map(x => [names[x.month - 1], x.basic, x.benefits, x.gross, x.nssf, x.shif, x.housingLevy, x.pension, x.taxablePay, x.taxCharged, x.personalRelief, x.paye])
  const total = (i: number) => m2(rows.reduce((s, r) => s + Number(r[i]), 0))
  rows.push(['TOTAL', total(1), total(2), total(3), total(4), total(5), total(6), total(7), total(8), total(9), total(10), total(11)])
  return { headers, rows, filename: `P9-${year}-${emp.employeeNo}` }
}

/** One-file annual summary of every employee's P9 totals (for the accountant / year-end iTax). */
export function buildAnnualSummary(employees: AnnualEmployeeRow[], year: number): CsvTable {
  const headers = ['Employee No', 'KRA PIN', 'Name', 'Months Paid', 'Gross Pay', 'NSSF', 'SHIF', 'Housing Levy', 'Taxable Pay', 'Tax Charged', 'Personal Relief', 'PAYE Deducted']
  const rows = employees.map(e => {
    const s = (f: (x: AnnualEmployeeRow['months'][number]) => number) => m2(e.months.reduce((a, x) => a + f(x), 0))
    return [e.employeeNo, e.kraPin, e.employeeName, e.months.length, s(x => x.gross), s(x => x.nssf), s(x => x.shif), s(x => x.housingLevy), s(x => x.taxablePay), s(x => x.taxCharged), s(x => x.personalRelief), s(x => x.paye)]
  })
  return { headers, rows, filename: `Annual-PAYE-summary-${year}` }
}
