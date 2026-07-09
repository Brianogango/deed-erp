import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { isLeaveTypeAllowedForGender, type EmployeeGender, type StoreLeaveType } from '@/lib/leave-utils'
import type { LeaveBalance } from '@/lib/store'

const WRITE_ROLES = ['director', 'admin_officer']

/**
 * PUT /api/leave-requests/balances
 * Body: { balances: LeaveBalance[] }
 * Upserts the supplied leave balances (init year, adjust entitlement, expire).
 * Used by: initYearBalances, updateLeaveBalance, expireYearEndBalances
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.balances)) {
    return NextResponse.json({ error: 'Expected { balances: LeaveBalance[] }' }, { status: 400 })
  }

  const balances: LeaveBalance[] = body.balances

  // Gender guard: maternity is female-only, paternity male-only. Zero out the
  // entitlement on mismatched rows so client-side year initialisation can never
  // grant maternity days to men (or paternity days to women).
  const employeeIds = [...new Set(balances.map(b => b.employeeId).filter(Boolean))]
  const genderRows = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, gender: true },
  }).catch(() => [])
  const genderById = new Map(genderRows.map(e => [e.id, (e.gender ?? null) as EmployeeGender]))

  let count = 0
  for (const b of balances) {
    if (!b.employeeId || !b.leaveType || typeof b.year !== 'number') continue
    const allowed = isLeaveTypeAllowedForGender(b.leaveType as StoreLeaveType, genderById.get(b.employeeId))
    await prisma.leaveBalance.upsert({
      where: { employeeId_leaveType_year: { employeeId: b.employeeId, leaveType: b.leaveType as any, year: b.year } },
      update: {
        entitlement: allowed ? Number(b.entitlement) || 0 : 0,
        carryForward: Number(b.carryForward) || 0,
        used: Number(b.used) || 0,
        pending: Number(b.pending) || 0,
      },
      create: {
        employeeId: b.employeeId, leaveType: b.leaveType as any, year: b.year,
        entitlement: allowed ? Number(b.entitlement) || 0 : 0,
        carryForward: Number(b.carryForward) || 0,
        used: Number(b.used) || 0,
        pending: Number(b.pending) || 0,
      },
    }).then(() => { count++ }).catch(() => {})
  }

  await writeFinancialAudit({ userId: session.user.id, action: 'adjust_leave_balances', entityType: 'leave_balance', newValues: { upserted: count } })
  return NextResponse.json({ ok: true, total: count })
}
