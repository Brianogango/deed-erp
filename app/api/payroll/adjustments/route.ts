import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'admin_officer', 'finance_officer']
const KINDS = ['earning', 'deduction', 'benefit_in_kind', 'insurance_premium'] as const
const MAX_AMOUNT = 10_000_000

const toClient = (a: { id: string; employeeId: string; periodYear: number; periodMonth: number; kind: string; label: string; amount: unknown; status: string; appliedRunId: string | null; createdAt: Date; employee?: { firstName: string; lastName: string; employeeNumber: string } | null }) => ({
  id: a.id,
  employeeId: a.employeeId,
  employeeName: a.employee ? `${a.employee.firstName} ${a.employee.lastName}`.trim() : '',
  employeeNo: a.employee?.employeeNumber ?? '',
  year: a.periodYear,
  month: a.periodMonth,
  kind: a.kind,
  label: a.label,
  amount: Number(a.amount),
  status: a.status,
  appliedRunId: a.appliedRunId,
  createdAt: a.createdAt.toISOString(),
})

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year')) || undefined
    const month = Number(url.searchParams.get('month')) || undefined
    const rows = await prisma.payrollAdjustment.findMany({
      where: { ...(year ? { periodYear: year } : {}), ...(month ? { periodMonth: month } : {}), status: { not: 'cancelled' } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } },
    })
    return NextResponse.json(rows.map(toClient))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const year = Number(body.year)
    const month = Number(body.month)
    const amount = Math.round((Number(body.amount) || 0) * 100) / 100
    const kind = String(body.kind ?? '')
    const label = String(body.label ?? '').trim().slice(0, 120)

    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Choose a valid month and year' }, { status: 400 })
    }
    if (!(KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'Choose what kind of item this is' }, { status: 400 })
    if (!label) return NextResponse.json({ error: 'Give the item a label, for example "Q3 bonus"' }, { status: 400 })
    if (!(amount > 0) || amount > MAX_AMOUNT) return NextResponse.json({ error: 'Enter an amount between 1 and 10,000,000' }, { status: 400 })

    const employee = await prisma.employee.findUnique({ where: { id: String(body.employeeId ?? '') }, select: { id: true, isActive: true } })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (!employee.isActive) return NextResponse.json({ error: 'That employee has exited' }, { status: 400 })

    // Once a run exists for the month its figures are fixed, so a new item would never be picked up.
    const existingRun = await prisma.payrollRun.findFirst({ where: { periodYear: year, periodMonth: String(month).padStart(2, '0') }, select: { runReference: true } })
      ?? await prisma.payrollRun.findFirst({ where: { periodYear: year, periodMonth: String(month) }, select: { runReference: true } })
    if (existingRun) {
      return NextResponse.json({ error: `Payroll ${existingRun.runReference} already exists for that month. Add this to next month's pay instead.` }, { status: 409 })
    }

    const created = await prisma.payrollAdjustment.create({
      data: {
        employeeId: employee.id, periodYear: year, periodMonth: month, kind, label, amount,
        createdById: /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null,
      },
      include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } },
    })
    await writeFinancialAudit({
      userId: actor.id, action: 'create_payroll_adjustment', entityType: 'employee', entityId: employee.id,
      newValues: { year, month, kind, label, amount },
    })
    return NextResponse.json(toClient(created), { status: 201 })
  })
}

/** Cancel an item that has not been picked up by a payroll run yet. */
export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const id = new URL(request.url).searchParams.get('id') || ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    const row = await prisma.payrollAdjustment.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.status !== 'pending') return NextResponse.json({ error: 'This item is already in a payroll run and can no longer be cancelled' }, { status: 409 })
    await prisma.payrollAdjustment.update({ where: { id }, data: { status: 'cancelled' } })
    await writeFinancialAudit({
      userId: actor.id, action: 'cancel_payroll_adjustment', entityType: 'employee', entityId: row.employeeId,
      oldValues: { kind: row.kind, label: row.label, amount: Number(row.amount) },
    })
    return NextResponse.json({ ok: true })
  })
}
