import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { EMPLOYEE_LEAVE_TYPES, isLeaveTypeAllowedForGender, requiredNotice, noticeDaysGiven, type EmployeeGender, type StoreLeaveType } from '@/lib/leave-utils'
import { toClientRequest, toClientBalance, defaultBalances, adjustBalance, getBalance } from '@/lib/hr/leave-store'

const HR_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

// ── GET — HR sees everything; a regular employee sees only their own ────────────
export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const isHr = isRoleAllowed(session.user.role, HR_ROLES)

    if (isHr) {
      const [requests, balances] = await Promise.all([
        prisma.leaveRequest.findMany({ orderBy: { createdAt: 'desc' } }),
        prisma.leaveBalance.findMany(),
      ])
      return NextResponse.json({
        requests: requests.map(r => toClientRequest(r as any)),
        balances: balances.map(b => toClientBalance(b as any)),
      })
    }

    const employee = await prisma.employee.findFirst({
      where: { user: { id: session.user.id } },
      select: { id: true, gender: true },
    }).catch(() => null)
    if (!employee?.id) return NextResponse.json({ requests: [], balances: [] })

    const year = new Date().getFullYear()
    const [requests, balances] = await Promise.all([
      prisma.leaveRequest.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: 'desc' } }),
      prisma.leaveBalance.findMany({ where: { employeeId: employee.id } }),
    ])
    const clientBalances = balances.map(b => toClientBalance(b as any))
    // Fill in any missing default balances for the current year so the employee
    // always sees their entitlements even before their first request.
    const merged = [
      ...clientBalances,
      ...defaultBalances(employee.id, year, employee.gender as EmployeeGender).filter(def =>
        !clientBalances.some(b => b.leaveType === def.leaveType && b.year === def.year)),
    ]
    return NextResponse.json({ requests: requests.map(r => toClientRequest(r as any)), balances: merged })
  })
}

// ── POST — HR bulk/booking, or self-service create (forced pending, own only) ───
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const isHr = isRoleAllowed(session.user.role, HR_ROLES)
    const body = await request.json()

    if (isHr) {
      const incoming: any[] = body.bulkRequests ?? [body]
      const created: string[] = []
      for (const req of incoming) {
        const leaveType = String(req.leaveType ?? '') as StoreLeaveType
        if (!leaveType) continue
        const days = Number(req.days ?? req.daysRequested ?? 0)
        const status = (req.status ?? 'approved') as string
        // Skip if a row with this id already exists (idempotent bulk).
        if (req.id) {
          const exists = await prisma.leaveRequest.findUnique({ where: { id: req.id } }).catch(() => null)
          if (exists) continue
        }
        const row = await prisma.leaveRequest.create({
          data: {
            ...(req.id ? { id: req.id } : {}),
            reference: req.ref ?? null,
            employeeId: req.employeeId,
            employeeName: req.employeeName ?? null,
            leaveType: leaveType as any,
            startDate: new Date(req.startDate),
            endDate: new Date(req.endDate),
            daysRequested: days,
            reason: req.reason ?? null,
            status: status as any,
            submittedByUserId: req.submittedByUserId ?? session.user.id,
            isSystemGenerated: !!req.isSystemGenerated,
            ...(status === 'approved' ? { reviewedByName: session.user.name, reviewedAt: new Date() } : {}),
          },
        })
        const year = new Date(req.startDate).getFullYear()
        await adjustBalance(req.employeeId, leaveType, year, status === 'approved' ? { used: days } : { pending: days })
        created.push(row.id)
      }
      // Optional explicit balance overrides (HR entitlement edits).
      if (Array.isArray(body.balances)) {
        for (const b of body.balances) {
          if (!b.employeeId || !b.leaveType) continue
          await prisma.leaveBalance.upsert({
            where: { employeeId_leaveType_year: { employeeId: b.employeeId, leaveType: b.leaveType, year: b.year } },
            update: { entitlement: Number(b.entitlement) || 0, carryForward: Number(b.carryForward) || 0, used: Number(b.used) || 0, pending: Number(b.pending) || 0 },
            create: { employeeId: b.employeeId, leaveType: b.leaveType, year: b.year, entitlement: Number(b.entitlement) || 0, carryForward: Number(b.carryForward) || 0, used: Number(b.used) || 0, pending: Number(b.pending) || 0 },
          })
        }
      }
      await writeFinancialAudit({ userId: session.user.id, action: 'hr_leave_write', entityType: 'leave_request', newValues: { created: created.length } })
      return NextResponse.json({ ok: true, added: created.length })
    }

    // ── Self-service ────────────────────────────────────────────────────────────
    if (body.bulkRequests) {
      return NextResponse.json({ error: 'Not permitted to submit bulk requests' }, { status: 403 })
    }
    // Older clients attach a `balances` snapshot to the application. It is
    // ignored (never applied) — the server owns balance arithmetic here.
    const employee = await prisma.employee.findFirst({
      where: { user: { id: session.user.id } },
      select: { id: true, firstName: true, lastName: true, gender: true },
    }).catch(() => null)
    if (!employee?.id) return NextResponse.json({ error: 'No employee profile is linked to your account. Contact HR.' }, { status: 403 })

    const leaveType = String(body.leaveType ?? '') as StoreLeaveType
    if (!EMPLOYEE_LEAVE_TYPES.includes(leaveType)) return NextResponse.json({ error: 'Invalid leave type' }, { status: 422 })
    if (!isLeaveTypeAllowedForGender(leaveType, employee.gender as EmployeeGender)) {
      return NextResponse.json({ error: `${leaveType === 'maternity' ? 'Maternity' : 'Paternity'} leave is not applicable to your employee record` }, { status: 422 })
    }
    const days = Number(body.days)
    if (!Number.isFinite(days) || days <= 0) return NextResponse.json({ error: 'Leave days must be greater than zero' }, { status: 422 })
    if (!body.startDate || !body.endDate) return NextResponse.json({ error: 'Start and end dates are required' }, { status: 422 })

    // Notice-period check (mirrors the client rule, enforced server-side).
    const notice = requiredNotice(leaveType, days)
    if (notice > 0 && noticeDaysGiven(String(body.startDate)) < notice) {
      return NextResponse.json({ error: `Insufficient notice: ${notice} working days required before the start date` }, { status: 422 })
    }

    const year = new Date(body.startDate).getFullYear()
    const bal = await getBalance(employee.id, leaveType, year)
    const remaining = bal.entitlement + bal.carryForward - bal.used - bal.pending
    if (bal.entitlement > 0 && days > remaining) {
      return NextResponse.json({ error: `Insufficient ${leaveType} balance: ${remaining} day(s) remaining` }, { status: 422 })
    }

    // Overlap guard against the employee's own active requests.
    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ['pending_hr', 'approved'] as any },
        startDate: { lte: new Date(body.endDate) },
        endDate: { gte: new Date(body.startDate) },
      },
    }).catch(() => null)
    if (overlap) return NextResponse.json({ error: 'These dates overlap an existing leave request' }, { status: 422 })

    const employeeName = `${employee.firstName} ${employee.lastName}`.trim()
    const row = await prisma.leaveRequest.create({
      data: {
        reference: typeof body.ref === 'string' && body.ref ? body.ref : `LV/${Date.now().toString(36).toUpperCase()}`,
        employeeId: employee.id,
        employeeName,
        leaveType: leaveType as any,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        daysRequested: days,
        reason: String(body.reason ?? ''),
        status: 'pending_hr' as any,
        submittedByUserId: session.user.id,
        isSystemGenerated: false,
      },
    })
    await adjustBalance(employee.id, leaveType, year, { pending: days })
    await writeFinancialAudit({ userId: session.user.id, action: 'apply_leave', entityType: 'leave_request', entityId: row.id, newValues: { leaveType, days, employeeId: employee.id } })

    return NextResponse.json({ ok: true, added: 1, request: toClientRequest(row as any) })
  })
}
