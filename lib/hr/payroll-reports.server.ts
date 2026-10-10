import 'server-only'
import prisma from '@/lib/prisma'

import type { StatutoryRow, StatutoryReport, AnnualEmployeeRow, PayslipDetail } from '@/lib/hr/payroll-report-types'
export type { StatutoryRow, StatutoryReport, AnnualEmployeeRow, PayslipDetail }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round(n * 100) / 100



function advanceTotal(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return r2(value.reduce((sum, item) => sum + num((item as { amount?: unknown })?.amount), 0))
}

export async function loadStatutoryReport(runId: string): Promise<StatutoryReport | null> {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } })
  if (!run) return null
  const [payslips, components] = await Promise.all([
    prisma.payslip.findMany({
      where: { payrollRunId: runId },
      include: { employee: true },
      orderBy: { employeeName: 'asc' },
    }),
    prisma.payrollComponentLine.findMany({ where: { payrollRunId: runId } }),
  ])
  const employer = new Map<string, { nssf: number; ahl: number; benefit: number; insurance: number }>()
  for (const c of components) {
    const cur = employer.get(c.payslipId) ?? { nssf: 0, ahl: 0, benefit: 0, insurance: 0 }
    if (c.componentCode === 'NSSF') cur.nssf += num(c.employerAmount)
    if (c.componentCode === 'AHL') cur.ahl += num(c.employerAmount)
    if (c.componentCode === 'BENEFIT_IN_KIND') cur.benefit += num(c.amount)
    if (c.componentCode === 'INSURANCE_RELIEF') cur.insurance += num(c.amount)
    employer.set(c.payslipId, cur)
  }

  const rows: StatutoryRow[] = payslips.map(p => {
    const e = p.employee
    const er = employer.get(p.id) ?? { nssf: 0, ahl: 0, benefit: 0, insurance: 0 }
    return {
      employeeId: p.employeeId,
      employeeNo: e.employeeNumber,
      employeeName: p.employeeName || `${e.firstName} ${e.lastName}`.trim(),
      firstName: e.firstName,
      lastName: e.lastName,
      idNumber: e.idNumber ?? '',
      kraPin: e.kraPin ?? '',
      nssfNumber: e.nssfNumber ?? '',
      shaNumber: e.shift ?? '',
      paymentMode: e.paymentMode,
      bankName: e.bankName ?? '',
      bankAccount: e.bankAccount ?? '',
      mpesaNumber: e.mpesaNumber ?? e.phone ?? '',
      basic: num(p.basicSalary),
      housingAllowance: num(p.houseAllowance),
      transportAllowance: num(p.transportAllowance),
      commission: num(p.commission),
      overtimePay: num(p.overtimePay),
      otherAdditions: num(p.otherAdditions),
      gross: num(p.grossPay),
      nssf: num(p.nssf),
      employerNssf: r2(er.nssf),
      shif: num(p.shif),
      housingLevy: num(p.housingLevy),
      employerHousingLevy: r2(er.ahl),
      pension: num(p.pensionContribution),
      personalRelief: num(p.personalRelief),
      nonCashBenefits: r2(er.benefit),
      insuranceRelief: r2(er.insurance),
      paye: num(p.paye),
      loanDeductions: num(p.loanDeductions),
      otherDeductions: num(p.otherDeductions),
      advanceDeductions: advanceTotal(p.advanceDeductions),
      totalDeductions: num(p.totalDeductions),
      net: num(p.netPay),
      paymentStatus: p.paymentStatus,
    }
  })

  const totals: Record<string, number> = {}
  for (const key of ['basic', 'gross', 'nssf', 'employerNssf', 'shif', 'housingLevy', 'employerHousingLevy', 'paye', 'totalDeductions', 'net'] as const) {
    totals[key] = r2(rows.reduce((s, r) => s + r[key], 0))
  }

  return {
    run: {
      id: run.id,
      reference: run.runReference,
      month: run.periodMonth ?? String(run.periodStart.getUTCMonth() + 1),
      year: run.periodYear ?? run.periodStart.getUTCFullYear(),
      status: run.status,
      periodStart: run.periodStart.toISOString().slice(0, 10),
      periodEnd: run.periodEnd.toISOString().slice(0, 10),
    },
    rows,
    totals,
  }
}


/** Per-employee monthly figures for a calendar year (approved and posted runs only). */
export async function loadAnnualReport(year: number): Promise<AnnualEmployeeRow[]> {
  const payslips = await prisma.payslip.findMany({
    where: { payrollRun: { periodYear: year, status: { in: ['approved', 'posted'] } } },
    include: { employee: true, payrollRun: { select: { periodMonth: true } } },
  })
  const taxItems = await prisma.payrollComponentLine.findMany({
    where: { payslipId: { in: payslips.map(p => p.id) }, componentCode: { in: ['BENEFIT_IN_KIND', 'INSURANCE_RELIEF'] } },
  })
  const itemOf = (payslipId: string, code: string) =>
    r2(taxItems.filter(c => c.payslipId === payslipId && c.componentCode === code).reduce((s, c) => s + num(c.amount), 0))
  const byEmployee = new Map<string, AnnualEmployeeRow>()
  for (const p of payslips) {
    const month = Number(p.payrollRun.periodMonth) || 0
    if (month < 1 || month > 12) continue
    const row = byEmployee.get(p.employeeId) ?? {
      employeeId: p.employeeId,
      employeeNo: p.employee.employeeNumber,
      employeeName: p.employeeName || `${p.employee.firstName} ${p.employee.lastName}`.trim(),
      kraPin: p.employee.kraPin ?? '',
      months: [],
    }
    const gross = num(p.grossPay)
    const nssf = num(p.nssf), shif = num(p.shif), levy = num(p.housingLevy), pension = num(p.pensionContribution)
    const nonCash = itemOf(p.id, 'BENEFIT_IN_KIND')
    const insuranceRelief = itemOf(p.id, 'INSURANCE_RELIEF')
    const taxablePay = Math.max(0, r2(gross + nonCash - nssf - shif - levy - pension))
    const relief = num(p.personalRelief)
    const paye = num(p.paye)
    row.months.push({
      month,
      basic: num(p.basicSalary),
      benefits: r2(num(p.houseAllowance) + num(p.transportAllowance) + num(p.commission) + num(p.overtimePay) + num(p.otherAdditions) + nonCash),
      gross, nssf, shif, housingLevy: levy, pension, taxablePay,
      taxCharged: r2(paye + relief + insuranceRelief),
      personalRelief: relief,
      insuranceRelief,
      paye,
    })
    byEmployee.set(p.employeeId, row)
  }
  return [...byEmployee.values()]
    .map(r => ({ ...r, months: r.months.sort((a, b) => a.month - b.month) }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}


export async function loadPayslipDetail(payslipId: string): Promise<PayslipDetail | null> {
  const p = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: { employee: { include: { department: { select: { name: true } } } }, payrollRun: true },
  })
  if (!p) return null
  const comps = await prisma.payrollComponentLine.findMany({ where: { payslipId } })
  const er = (code: string) => r2(comps.filter(c => c.componentCode === code).reduce((s, c) => s + num(c.employerAmount), 0))
  const amt = (code: string) => r2(comps.filter(c => c.componentCode === code).reduce((s, c) => s + num(c.amount), 0))

  const year = p.payrollRun.periodYear ?? p.payrollRun.periodStart.getUTCFullYear()
  const month = Number(p.payrollRun.periodMonth) || p.payrollRun.periodStart.getUTCMonth() + 1
  const earlier = await prisma.payslip.findMany({
    where: { employeeId: p.employeeId, payrollRun: { periodYear: year, status: { in: ['approved', 'posted'] } } },
    include: { payrollRun: { select: { periodMonth: true } } },
  })
  const ytdRows = earlier.filter(x => (Number(x.payrollRun.periodMonth) || 0) <= month)
  const sum = (f: (x: typeof ytdRows[number]) => unknown) => r2(ytdRows.reduce((s, x) => s + num(f(x)), 0))

  const line = (label: string, amount: number) => ({ label, amount: r2(amount) })
  const keep = (rows: Array<{ label: string; amount: number }>, always: string[]) => rows.filter(r => r.amount !== 0 || always.includes(r.label))
  const advances = Array.isArray(p.advanceDeductions)
    ? (p.advanceDeductions as Array<{ ref?: string; amount?: unknown; remainingAfter?: unknown }>).map(a => ({
        ref: String(a.ref ?? ''), amount: num(a.amount), remainingAfter: num(a.remainingAfter),
      }))
    : []
  const advanceSum = r2(advances.reduce((s, a) => s + a.amount, 0))

  return {
    id: p.id,
    reference: p.reference ?? `PS/${p.id.slice(0, 8).toUpperCase()}`,
    status: p.status,
    paymentStatus: p.paymentStatus,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    period: {
      month: String(month), year,
      start: p.payrollRun.periodStart.toISOString().slice(0, 10),
      end: p.payrollRun.periodEnd.toISOString().slice(0, 10),
      runReference: p.payrollRun.runReference,
    },
    employee: {
      id: p.employeeId,
      number: p.employee.employeeNumber,
      name: p.employeeName || `${p.employee.firstName} ${p.employee.lastName}`.trim(),
      jobTitle: p.employee.jobTitle ?? '',
      department: p.employee.department?.name ?? '',
      kraPin: p.employee.kraPin ?? '',
      nssfNumber: p.employee.nssfNumber ?? '',
      shaNumber: p.employee.shift ?? '',
      idNumber: p.employee.idNumber ?? '',
      paymentMode: p.employee.paymentMode,
      bankName: p.employee.bankName ?? '',
      bankAccount: p.employee.bankAccount ?? '',
      mpesaNumber: p.employee.mpesaNumber ?? p.employee.phone ?? '',
    },
    earnings: keep([
      line('Basic salary', num(p.basicSalary)),
      line('House allowance', num(p.houseAllowance)),
      line('Transport allowance', num(p.transportAllowance)),
      line('Commission', num(p.commission)),
      line('Overtime', num(p.overtimePay)),
      line('Other additions', num(p.otherAdditions)),
    ], ['Basic salary']),
    deductions: keep([
      line('PAYE', num(p.paye)),
      line('NSSF', num(p.nssf)),
      line('SHIF', num(p.shif)),
      line('Affordable Housing Levy', num(p.housingLevy)),
      line('Pension', num(p.pensionContribution)),
      line('Loan repayment', num(p.loanDeductions)),
      line('Salary advance', advanceSum),
      line('Other deductions', num(p.otherDeductions)),
    ], []),
    employer: keep([
      line('Employer NSSF', er('NSSF')),
      line('Employer housing levy', er('AHL')),
    ], []),
    advances,
    taxNotes: [
      ...(amt('BENEFIT_IN_KIND') ? [{ label: 'Non-cash benefit (taxed, not paid)', amount: amt('BENEFIT_IN_KIND') }] : []),
      ...(amt('INSURANCE_RELIEF') ? [{ label: 'Insurance relief (reduces PAYE)', amount: amt('INSURANCE_RELIEF') }] : []),
    ],
    gross: num(p.grossPay),
    totalDeductions: num(p.totalDeductions),
    net: num(p.netPay),
    ytd: {
      gross: sum(x => x.grossPay),
      paye: sum(x => x.paye),
      nssf: sum(x => x.nssf),
      net: sum(x => x.netPay),
    },
  }
}
