import 'server-only'
import prisma from '@/lib/prisma'
import type { PayrollRun, Payslip, PayrollLine } from '@/lib/store'
import { calculateKenyaPayroll, KENYA_PAYROLL_RULES_2026_02, money } from '@/lib/hr/kenya-payroll'

// Map the relational payroll_runs / payslips rows to the client PayrollRun /
// Payslip shapes. The client's PayrollRun.lines are reconstructed from the
// stored payslips so nothing about the UI needs to change.

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const monthStart = (month: string, year: number) => new Date(Date.UTC(year, Math.max(0, (Number(month) || 1) - 1), 1))
const monthEnd = (month: string, year: number) => new Date(Date.UTC(year, Math.max(0, Number(month) || 1), 0))

export function payslipToClient(p: any): Payslip {
  return {
    id: p.id,
    ref: p.reference ?? `PS/${p.id.slice(0, 8).toUpperCase()}`,
    payrollRunId: p.payrollRunId,
    employeeId: p.employeeId,
    employeeName: p.employeeName ?? '',
    month: p.payrollRun?.periodMonth ?? '',
    year: p.payrollRun?.periodYear ?? new Date(p.createdAt).getFullYear(),
    grossPay: num(p.grossPay),
    deductions: num(p.totalDeductions),
    salaryAdvanceDeductions: Array.isArray(p.advanceDeductions) ? p.advanceDeductions : [],
    netPay: num(p.netPay),
    status: (p.status as Payslip['status']) ?? 'draft',
    paymentStatus: (p.paymentStatus as Payslip['paymentStatus']) ?? 'pending',
    paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : undefined,
    paymentReference: p.paymentReference ?? undefined,
    generatedDate: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    downloadUrl: undefined,
  }
}

function lineFromPayslip(p: any): PayrollLine {
  return {
    employeeId: p.employeeId,
    employeeName: p.employeeName ?? '',
    basicSalary: num(p.basicSalary),
    allowances: num(p.houseAllowance) + num(p.transportAllowance),
    deductions: num(p.totalDeductions),
    salaryAdvanceDeductions: Array.isArray(p.advanceDeductions) ? p.advanceDeductions : [],
    netPay: num(p.netPay),
  }
}

export function runToClient(run: any, payslips: any[]): PayrollRun {
  const mine = payslips.filter(p => p.payrollRunId === run.id)
  return {
    id: run.id,
    ref: run.runReference,
    month: run.periodMonth ?? String(new Date(run.periodStart).getMonth() + 1),
    year: run.periodYear ?? new Date(run.periodStart).getFullYear(),
    status: (run.status as PayrollRun['status']) ?? 'pending_approval',
    lines: mine.map(lineFromPayslip),
    totalGross: num(run.totalGross),
    totalDeductions: num(run.totalDeductions),
    totalNet: num(run.totalNet),
    postedJournalId: run.postedJournalId ?? undefined,
  }
}

/** Persist a client PayrollRun + its payslips into Prisma. Forces pending_approval. */
export async function createRunFromClient(run: PayrollRun, payslips: Payslip[], createdById: string | null) {
  const rule = await prisma.statutoryRuleVersion.upsert({
    where: {
      code_effectiveFrom: {
        code: 'KENYA_PAYROLL',
        effectiveFrom: new Date(`${KENYA_PAYROLL_RULES_2026_02.effectiveFrom}T00:00:00Z`),
      },
    },
    update: { rules: KENYA_PAYROLL_RULES_2026_02 as any },
    create: {
      code: 'KENYA_PAYROLL',
      effectiveFrom: new Date(`${KENYA_PAYROLL_RULES_2026_02.effectiveFrom}T00:00:00Z`),
      rules: KENYA_PAYROLL_RULES_2026_02 as any,
      sourceReference: 'KRA PAYE guidance; SHA SHIF; NSSF Year 4 2026 notice',
    },
  })

  const computed = payslips.map(ps => {
    const runLine = run.lines.find(l => l.employeeId === ps.employeeId)
    const basic = num(runLine?.basicSalary) || num(ps.grossPay)
    const allowances = num(runLine?.allowances)
    const advanceRows = ps.salaryAdvanceDeductions ?? []
    const advanceTotal = money(advanceRows.reduce((sum, item: any) => sum + num(item?.amount), 0))
    const calc = calculateKenyaPayroll(
      basic,
      allowances,
      0,
      { advanceDeductions: advanceTotal },
    )
    return { ps, runLine, calc, advanceRows }
  })

  const totals = computed.reduce((a, row) => {
    a.gross += row.calc.grossSalary
    a.paye += row.calc.paye
    a.nssf += row.calc.nssf
    a.shif += row.calc.shif
    a.housing += row.calc.housingLevy
    a.employer += row.calc.employerNssf + row.calc.employerHousingLevy
    a.deductions += row.calc.totalDeductions
    a.net += row.calc.netSalary
    return a
  }, { gross: 0, paye: 0, nssf: 0, shif: 0, housing: 0, employer: 0, deductions: 0, net: 0 })

  const created = await prisma.$transaction(async tx => {
    const payrollRun = await tx.payrollRun.create({
      data: {
        ...(run.id ? { id: run.id } : {}),
        runReference: run.ref,
        periodStart: monthStart(run.month, run.year),
        periodEnd: monthEnd(run.month, run.year),
        runDate: new Date(),
        periodMonth: String(run.month),
        periodYear: run.year,
        status: 'pending_approval',
        postingStatus: 'unposted',
        totalGross: money(totals.gross),
        totalPaye: money(totals.paye),
        totalNhif: 0,
        totalNssf: money(totals.nssf),
        totalShif: money(totals.shif),
        totalHousingLevy: money(totals.housing),
        totalEmployerContributions: money(totals.employer),
        totalDeductions: money(totals.deductions),
        totalNet: money(totals.net),
        statutoryRuleVersionId: rule.id,
        createdById: createdById && /^[0-9a-f-]{36}$/i.test(createdById) ? createdById : null,
      },
    })

    for (const row of computed) {
      const { ps, calc, advanceRows } = row
      const payslip = await tx.payslip.create({
        data: {
          ...(ps.id ? { id: ps.id } : {}),
          payrollRunId: payrollRun.id,
          employeeId: ps.employeeId,
          reference: ps.ref,
          employeeName: ps.employeeName,
          basicSalary: calc.basicSalary,
          houseAllowance: calc.houseAllowance,
          transportAllowance: calc.transportAllowance,
          commission: calc.commission,
          overtimePay: calc.overtimePay,
          otherAdditions: calc.otherAdditions,
          grossPay: calc.grossSalary,
          paye: calc.paye,
          nhif: 0,
          shif: calc.shif,
          housingLevy: calc.housingLevy,
          pensionContribution: calc.pensionContribution,
          personalRelief: calc.personalRelief,
          nssf: calc.nssf,
          otherDeductions: calc.otherDeductions,
          loanDeductions: calc.loanDeductions,
          totalDeductions: calc.totalDeductions,
          netPay: calc.netSalary,
          advanceDeductions: advanceRows as any,
          status: 'draft',
        },
      })

      const components = [
        ['BASIC', 'earning', calc.basicSalary, 0, true],
        ['HOUSING_ALLOWANCE', 'earning', calc.houseAllowance, 0, true],
        ['TRANSPORT_ALLOWANCE', 'earning', calc.transportAllowance, 0, true],
        ['PAYE', 'statutory_deduction', calc.paye, 0, false],
        ['NSSF', 'statutory_deduction', calc.nssf, calc.employerNssf, true],
        ['SHIF', 'statutory_deduction', calc.shif, 0, true],
        ['AHL', 'statutory_deduction', calc.housingLevy, calc.employerHousingLevy, true],
        ['PENSION', 'deduction', calc.pensionContribution, 0, true],
        ['SALARY_ADVANCE', 'receivable_recovery', calc.advanceDeductions, 0, false],
      ] as const
      for (const [componentCode, componentType, amount, employerAmount, taxable] of components) {
        if (money(amount) === 0 && money(employerAmount) === 0) continue
        await tx.payrollComponentLine.create({
          data: {
            payrollRunId: payrollRun.id,
            payslipId: payslip.id,
            employeeId: ps.employeeId,
            componentCode,
            componentType,
            amount: money(amount),
            employerAmount: money(employerAmount),
            taxable,
            statutoryRuleVersionId: rule.id,
          },
        })
      }
    }
    return payrollRun
  }, { isolationLevel: 'Serializable' })

  return created
}
