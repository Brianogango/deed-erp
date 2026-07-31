import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { CALENDAR_DAY_TYPES, calcCalendarDays, calcWorkingDays, EMPLOYEE_LEAVE_TYPES, isLeaveTypeAllowedForGender, requiredNotice, noticeDaysGiven, type EmployeeGender, type StoreLeaveType } from '@/lib/leave-utils'
import { toClientRequest, toClientBalance, defaultBalances, adjustBalance, getBalance } from '@/lib/hr/leave-store'
import {
  notifyLeaveApplied,
  notifyLeaveBookedForEmployee,
  queueLeaveNotification,
  toLeaveNotifyPayload,
} from '@/lib/hr/leave-notifications'

const HR_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

// The next sequential LV/NNNN reference based on what is already persisted.
// Client-generated refs come from per-browser localStorage counters, so two
// users (or a fresh browser) easily produce the same number — the server owns
// the real reference and treats the client's value as a placeholder at best.
async function nextLeaveReference(): Promise<string> {
  const rows = await prisma.$queryRaw<{ n: number | bigint | null }[]>`
    SELECT MAX(substring(reference from 4)::int) AS n
    FROM leave_requests WHERE reference ~ '^LV/[0-9]+$'`
  const next = Number(rows?.[0]?.n ?? 0) + 1
  return `LV/${String(next).padStart(4, '0')}`
}

// Create a leave request, regenerating the reference on a unique-constraint
// collision (stale client ref or a concurrent insert racing for the same
// sequence number). Falls back to a timestamp-based ref as a last resort.
async function createLeaveRequest(data: Record<string, unknown>, preferredRef?: string | null) {
  let reference = preferredRef || await nextLeaveReference()
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.leaveRequest.create({ data: { ...data, reference } as any })
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err
      reference = await nextLeaveReference()
    }
  }
  return prisma.leaveRequest.create({ data: { ...data, reference: `LV/${Date.now().toString(36).toUpperCase()}` } as any })
}

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
      // An HR-role user's OWN leave is never self-approved — it is forced to
      // pending so another director/HR officer has to decide it.
      const ownEmployee = await prisma.employee.findFirst({
        where: { user: { id: session.user.id } },
        select: { id: true },
      }).catch(() => null)
      const incoming: any[] = body.bulkRequests ?? [body]
      const created: string[] = []
      const pendingNotify: Array<{ id: string }> = []
      const bookedNotify: Array<{ id: string }> = []
      for (const req of incoming) {
        const leaveType = String(req.leaveType ?? '') as StoreLeaveType
        if (!leaveType) continue
        const days = Number(req.days ?? req.daysRequested ?? 0)
        const isOwnRequest = !req.isSystemGenerated && !!ownEmployee?.id && req.employeeId === ownEmployee.id
        const status = isOwnRequest ? 'pending_hr' : ((req.status ?? 'approved') as string)
        // Skip if a row with this id already exists (idempotent bulk).
        if (req.id) {
          const exists = await prisma.leaveRequest.findUnique({ where: { id: req.id } }).catch(() => null)
          if (exists) continue
        }
        const row = await createLeaveRequest({
          ...(req.id ? { id: req.id } : {}),
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
        }, typeof req.ref === 'string' && req.ref ? req.ref : null)
        const year = new Date(req.startDate).getFullYear()
        await adjustBalance(req.employeeId, leaveType, year, status === 'approved' ? { used: days } : { pending: days })
        created.push(row.id)
        if (status === 'pending_hr') pendingNotify.push({ id: row.id })
        else if (status === 'approved' && !req.isSystemGenerated) bookedNotify.push({ id: row.id })
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

      // Email after persist — never blocks the write.
      for (const item of pendingNotify) {
        queueLeaveNotification(async () => {
          const row = await prisma.leaveRequest.findUnique({ where: { id: item.id } })
          if (!row || row.status !== 'pending_hr') return
          await notifyLeaveApplied(toLeaveNotifyPayload(row as any))
        })
      }
      for (const item of bookedNotify) {
        queueLeaveNotification(async () => {
          const row = await prisma.leaveRequest.findUnique({ where: { id: item.id } })
          if (!row || row.status !== 'approved') return
          await notifyLeaveBookedForEmployee(toLeaveNotifyPayload({
            ...(row as any),
            reviewedByName: row.reviewedByName || session.user.name,
          }))
        })
      }

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
    if (!body.startDate || !body.endDate) return NextResponse.json({ error: 'Start and end dates are required' }, { status: 422 })
    // The day count is always derived from the date range — never trusted from
    // the client — so an application can never reserve more (or fewer) days
    // than the dates actually cover. Maternity/paternity use calendar days;
    // everything else uses working days (Mon–Fri, excl. Kenyan public holidays).
    const startStr = String(body.startDate).slice(0, 10)
    const endStr = String(body.endDate).slice(0, 10)
    const days = CALENDAR_DAY_TYPES.includes(leaveType)
      ? calcCalendarDays(startStr, endStr)
      : calcWorkingDays(startStr, endStr)
    if (days <= 0) {
      return NextResponse.json({ error: 'The selected dates contain no leave days — check that the end date is not before the start date and the range is not only weekends/public holidays' }, { status: 422 })
    }

    // Notice-period check (mirrors the client rule, enforced server-side).
    const notice = requiredNotice(leaveType, days)
    if (notice > 0 && noticeDaysGiven(String(body.startDate)) < notice) {
      return NextResponse.json({ error: `Insufficient notice: ${notice} working days required before the start date` }, { status: 422 })
    }

    // Balance enforcement: an application may never exceed the remaining
    // balance. Unpaid leave is the only type without an entitlement to check.
    const year = new Date(body.startDate).getFullYear()
    const bal = await getBalance(employee.id, leaveType, year)
    const remaining = bal.entitlement + bal.carryForward - bal.used - bal.pending
    if (leaveType !== 'unpaid' && days > remaining) {
      return NextResponse.json({ error: `Insufficient ${leaveType} balance: ${Math.max(0, remaining)} day(s) remaining, ${days} requested` }, { status: 422 })
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
    // The client's ref comes from a per-browser counter and regularly collides
    // with existing rows — the server always assigns the real reference.
    const row = await createLeaveRequest({
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
    })
    await adjustBalance(employee.id, leaveType, year, { pending: days })
    await writeFinancialAudit({ userId: session.user.id, action: 'apply_leave', entityType: 'leave_request', entityId: row.id, newValues: { leaveType, days, employeeId: employee.id } })

    queueLeaveNotification(async () => {
      await notifyLeaveApplied(toLeaveNotifyPayload(row as any))
    })

    return NextResponse.json({ ok: true, added: 1, request: toClientRequest(row as any) })
  })
}
