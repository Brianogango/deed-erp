import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { toClientAdvance, toDbAdvance } from '@/lib/hr/salary-advance-store'
import { publishSalaryAdvanceApplied } from '@/lib/notifications/hr-events'
import { z } from 'zod'

// HR/finance manage all advances; a regular employee sees/creates only their own.
const HR_ROLES = ['director', 'finance_officer']

const salaryAdvanceCreateSchema = z.object({
  employeeId: z.string().min(1).max(64).optional(),
  employeeName: z.string().trim().max(160).optional(),
  amount: z.coerce.number().positive().max(9_999_999_999.99),
  paymentTerms: z.string().trim().min(1).max(30).optional(),
  repaymentMonths: z.coerce.number().int().min(1).max(60).optional(),
  repaymentStartPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
  monthlyDeduction: z.coerce.number().min(0).max(9_999_999_999.99).optional(),
  reason: z.string().trim().max(5_000).optional(),
  neededByDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  // Kept as compatibility inputs only. The server never persists these values.
  id: z.string().max(64).optional(),
  ref: z.string().max(40).optional(),
  status: z.string().max(20).optional(),
}).strict()

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
    const parsed = salaryAdvanceCreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid salary advance request', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 422 },
      )
    }

    const body = parsed.data
    const isHr = isRoleAllowed(session.user.role, HR_ROLES)

    // Self-service ownership is resolved from the authenticated session. A
    // caller cannot submit another employee's UUID and create a request for them.
    let employeeId = body.employeeId
    let employeeName = body.employeeName
    if (!isHr) {
      const ownEmployee = await prisma.employee.findFirst({
        where: { user: { id: session.user.id } },
        select: { id: true, firstName: true, lastName: true },
      }).catch(() => null)
      if (!ownEmployee?.id) {
        return NextResponse.json({ error: 'No employee profile is linked to your account. Contact HR.' }, { status: 403 })
      }
      employeeId = ownEmployee.id
      employeeName = [ownEmployee.firstName, ownEmployee.lastName].filter(Boolean).join(' ') || employeeName
    } else if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 422 })
    }

    const safeCreate = {
      employeeId,
      employeeName,
      amount: body.amount,
      paymentTerms: body.paymentTerms,
      repaymentMonths: body.repaymentMonths,
      repaymentStartPeriod: body.repaymentStartPeriod,
      monthlyDeduction: body.monthlyDeduction,
      reason: body.reason,
      neededByDate: body.neededByDate,
    }

    // id/ref/status/audit/recovery fields are system-owned on creation.
    const row = await prisma.salaryAdvance.create({
      data: {
        ...(toDbAdvance(safeCreate as any) as any),
        status: 'pending',
        createdByUserId: session.user.id,
        requestedDate: new Date(),
      },
    })
    await writeFinancialAudit({ userId: session.user.id, action: 'salary_advance_apply', entityType: 'salary_advance', entityId: row.id, newValues: { amount: Number(row.amount), employeeId: row.employeeId } })

    await publishSalaryAdvanceApplied(row as any, session.user.id)

    return NextResponse.json(toClientAdvance(row), { status: 201 })
  })
}
