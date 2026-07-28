import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { toClientAdvance, toDbAdvance } from '@/lib/hr/salary-advance-store'

// HR/finance manage all advances; a regular employee sees/creates only their own.
const HR_ROLES = ['director', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const isHr = isRoleAllowed(session.user.role, HR_ROLES)
    if (isHr) {
      const rows = await prisma.salaryAdvance.findMany({ orderBy: { requestedDate: 'desc' } })
      return NextResponse.json(rows.map(toClientAdvance))
    }
    const employee = await prisma.employee.findFirst({ where: { user: { id: session.user.id } }, select: { id: true } }).catch(() => null)
    if (!employee?.id) return NextResponse.json([])
    const rows = await prisma.salaryAdvance.findMany({ where: { employeeId: employee.id }, orderBy: { requestedDate: 'desc' } })
    return NextResponse.json(rows.map(toClientAdvance))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    if (!body.employeeId || !(Number(body.amount) > 0)) {
      return NextResponse.json({ error: 'employeeId and a positive amount are required' }, { status: 422 })
    }
    // New advances always start pending regardless of client input.
    const row = await prisma.salaryAdvance.create({
      data: {
        ...(toDbAdvance(body) as any),
        status: 'pending',
        createdByUserId: session.user.id,
        requestedDate: new Date(),
      },
    })
    await writeFinancialAudit({ userId: session.user.id, action: 'salary_advance_apply', entityType: 'salary_advance', entityId: row.id, newValues: { amount: Number(row.amount), employeeId: row.employeeId } })
    return NextResponse.json(toClientAdvance(row), { status: 201 })
  })
}
