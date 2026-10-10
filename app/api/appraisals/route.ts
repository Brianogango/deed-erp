import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { isUserAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { HR_ROLES, appraisalsFor, toClientCycle } from '@/lib/hr/appraisals.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const isHr = isUserAllowed(user, HR_ROLES)
    const appraisals = await appraisalsFor(user, isHr)
    const cycleIds = [...new Set(appraisals.map(a => a.cycleId))]
    const cycles = await prisma.appraisalCycle.findMany({
      where: isHr ? {} : { id: { in: cycleIds } },
      orderBy: { periodStart: 'desc' },
      take: 50,
    })
    return NextResponse.json({ cycles: cycles.map(toClientCycle), appraisals })
  })
}

/** Open a review cycle and create a review for every active employee. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(HR_ROLES)
    const body = await request.json().catch(() => ({}))
    const name = String(body.name ?? '').trim().slice(0, 120)
    const start = new Date(`${String(body.periodStart ?? '').slice(0, 10)}T00:00:00Z`)
    const end = new Date(`${String(body.periodEnd ?? '').slice(0, 10)}T00:00:00Z`)
    if (!name) return NextResponse.json({ error: 'Name the review cycle, for example "Mid-year 2026"' }, { status: 400 })
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return NextResponse.json({ error: 'Enter the period the review covers' }, { status: 400 })

    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, managerId: true },
    })
    if (employees.length === 0) return NextResponse.json({ error: 'There are no active employees to review' }, { status: 400 })
    const managerIds = [...new Set(employees.map(e => e.managerId).filter((v): v is string => !!v))]
    const managers = await prisma.employee.findMany({ where: { id: { in: managerIds } }, select: { id: true, firstName: true, lastName: true } })
    const managerName = new Map(managers.map(m => [m.id, `${m.firstName} ${m.lastName}`.trim()]))

    const cycle = await prisma.$transaction(async tx => {
      const c = await tx.appraisalCycle.create({
        data: { name, periodStart: start, periodEnd: end, createdById: /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null },
      })
      await tx.appraisal.createMany({
        data: employees.map(e => ({ cycleId: c.id, employeeId: e.id, reviewerName: e.managerId ? managerName.get(e.managerId) ?? null : null })),
      })
      return c
    })
    await writeFinancialAudit({
      userId: actor.id, action: 'open_appraisal_cycle', entityType: 'appraisal_cycle', entityId: cycle.id,
      newValues: { name, employees: employees.length },
    })
    return NextResponse.json({ cycle: toClientCycle(cycle), created: employees.length }, { status: 201 })
  })
}
