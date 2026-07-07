import 'server-only'
import prisma from '@/lib/prisma'
import type { PayrollRun, Payslip, PayrollLine } from '@/lib/store'

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
  const totalPaye = 0, totalNhif = 0, totalNssf = 0 // detailed statutory split not tracked per-line client-side
  const created = await prisma.payrollRun.create({
    data: {
      ...(run.id ? { id: run.id } : {}),
      runReference: run.ref,
      periodStart: monthStart(run.month, run.year),
      periodEnd: monthEnd(run.month, run.year),
      runDate: new Date(),
      periodMonth: String(run.month),
      periodYear: run.year,
      status: 'pending_approval',
      totalGross: run.totalGross,
      totalPaye, totalNhif, totalNssf,
      totalDeductions: run.totalDeductions,
      totalNet: run.totalNet,
      createdById: createdById && /^[0-9a-f-]{36}$/i.test(createdById) ? createdById : null,
    },
  })
  for (const ps of payslips) {
    const grossPay = num(ps.grossPay)
    const deductions = num(ps.deductions)
    await prisma.payslip.create({
      data: {
        ...(ps.id ? { id: ps.id } : {}),
        payrollRunId: created.id,
        employeeId: ps.employeeId,
        reference: ps.ref,
        employeeName: ps.employeeName,
        basicSalary: grossPay, // client payslip carries combined gross; per-component split lives on the run
        houseAllowance: 0,
        transportAllowance: 0,
        grossPay,
        totalDeductions: deductions,
        netPay: num(ps.netPay),
        advanceDeductions: (ps.salaryAdvanceDeductions ?? []) as any,
        status: ps.status ?? 'draft',
      },
    })
  }
  return created
}
