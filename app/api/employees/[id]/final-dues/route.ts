import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer', 'finance_officer']
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round(n * 100) / 100

/** Starting figures for the final dues statement. HR can adjust them before the statement is produced. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const exitDate = new URL(request.url).searchParams.get('exitDate') || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exitDate)) return NextResponse.json({ error: 'exitDate must be YYYY-MM-DD' }, { status: 400 })

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: { id: true, basicSalary: true, housingAllowance: true, transportAllowance: true, startDate: true },
    })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const year = Number(exitDate.slice(0, 4))
    const [balance, loans, advances] = await Promise.all([
      prisma.leaveBalance.findUnique({ where: { employeeId_leaveType_year: { employeeId: id, leaveType: 'annual', year } } }),
      prisma.employeeLoan.findMany({ where: { employeeId: id, isCleared: false }, select: { outstanding: true } }),
      prisma.salaryAdvance.findMany({ where: { employeeId: id, status: 'paid' }, select: { outstandingAmount: true } }),
    ])

    // Annual leave accrues through the year, so credit only the portion earned to the exit date.
    const exit = new Date(`${exitDate}T00:00:00Z`)
    const yearStart = Date.UTC(year, 0, 1)
    const accruedShare = Math.min(1, Math.max(0, (exit.getTime() - yearStart) / (365 * 86400000)))
    const entitlement = num(balance?.entitlement)
    const carryForward = num(balance?.carryForward)
    const used = num(balance?.used)
    const accrued = carryForward + entitlement * accruedShare
    const unusedLeaveDays = Math.max(0, Math.round((accrued - used) * 2) / 2)

    return NextResponse.json({
      exitDate,
      basicSalary: num(employee.basicSalary),
      housingAllowance: num(employee.housingAllowance),
      transportAllowance: num(employee.transportAllowance),
      unusedLeaveDays,
      leave: { entitlement, carryForward, used, accrued: r2(accrued) },
      outstandingLoans: r2(loans.reduce((s, l) => s + num(l.outstanding), 0)),
      outstandingAdvances: r2(advances.reduce((s, a) => s + num(a.outstandingAmount), 0)),
    })
  })
}
