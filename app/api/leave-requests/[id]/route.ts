import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { toClientRequest, adjustBalance, getBalance } from '@/lib/hr/leave-store'
import { leaveDaysForRange, type StoreLeaveType } from '@/lib/leave-utils'
import { publishLeaveCancelled, publishLeaveDecision } from '@/lib/notifications/hr-events'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

// Approve / reject / cancel a leave request. Balance counters are recomputed
// server-side from the transition — the client no longer supplies balances.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await prisma.leaveRequest.findUnique({ where: { id: resolvedParams.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const requested = body.request ?? body
  const nextStatus = String(requested.status ?? existing.status) as 'pending_hr' | 'approved' | 'rejected' | 'cancelled'

  const isOwnLeave = async () => {
    const ownEmployee = await prisma.employee.findFirst({
      where: { user: { id: session.user.id } },
      select: { id: true },
    }).catch(() => null)
    return existing.submittedByUserId === session.user.id || (!!ownEmployee?.id && existing.employeeId === ownEmployee.id)
  }

  // Approved leave that was not (fully) taken: the employee came back early.
  // The leave ends on the last day actually taken; the unused days go back to
  // the balance. Leave not taken at all is cancelled instead (status
  // 'cancelled'), which returns every day.
  if (body.action === 'return_early') {
    if (existing.status !== 'approved') return NextResponse.json({ error: 'Only approved leave can be shortened' }, { status: 409 })
    if (await isOwnLeave()) return NextResponse.json({ error: 'Another director or HR officer must record your return from leave' }, { status: 403 })
    const lastDay = String(body.lastDayTaken ?? '').slice(0, 10)
    const start = existing.startDate.toISOString().slice(0, 10)
    const end = existing.endDate.toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || lastDay < start) {
      return NextResponse.json({ error: 'Enter the last day the employee was actually on leave (on or after the start date). If they never went, cancel the leave instead.' }, { status: 422 })
    }
    if (lastDay >= end) return NextResponse.json({ error: 'That is the full leave — nothing to return' }, { status: 422 })
    const leaveType = existing.leaveType as StoreLeaveType
    const days = Number(existing.daysRequested)
    const taken = leaveDaysForRange(leaveType, start, lastDay)
    const unused = Math.max(0, days - taken)
    if (unused <= 0) return NextResponse.json({ error: 'No leave days fall after that date — nothing to return' }, { status: 422 })
    await adjustBalance(existing.employeeId, leaveType, existing.startDate.getFullYear(), { used: -unused })
    const note = typeof body.note === 'string' && body.note.trim() ? ` — ${body.note.trim().slice(0, 300)}` : ''
    const line = `Returned early: last day on leave ${lastDay} (was ${end}); ${taken} of ${days} day(s) taken, ${unused} returned to balance. Recorded by ${session.user.name} on ${new Date().toISOString().slice(0, 10)}${note}`
    const shortened = await prisma.leaveRequest.update({
      where: { id: resolvedParams.id },
      data: {
        endDate: new Date(`${lastDay}T00:00:00.000Z`),
        daysRequested: taken,
        reviewNotes: [existing.reviewNotes, line].filter(Boolean).join('\n'),
      },
    })
    await writeFinancialAudit({
      userId: session.user.id,
      action: 'return_early_leave',
      entityType: 'leave_request',
      entityId: resolvedParams.id,
      oldValues: { endDate: end, days },
      newValues: { endDate: lastDay, days: taken, returned: unused, employeeId: existing.employeeId },
    })
    return NextResponse.json({ item: toClientRequest(shortened as any), returnedDays: unused })
  }

  // Nobody may approve or reject their own leave — not even directors/HR —
  // nor cancel their own leave once approved (that gives the days back).
  // (Cancelling your own pending request remains allowed.)
  const decidingOwn = ((nextStatus === 'approved' || nextStatus === 'rejected') && nextStatus !== existing.status)
    || (existing.status === 'approved' && nextStatus === 'cancelled')
  if (decidingOwn && await isOwnLeave()) {
    return NextResponse.json({
      error: nextStatus === 'cancelled'
        ? 'Another director or HR officer must cancel your approved leave'
        : 'You cannot approve or reject your own leave request — another director or HR officer must decide it',
    }, { status: 403 })
  }
  const year = new Date(existing.startDate).getFullYear()
  const days = Number(existing.daysRequested)
  const leaveType = existing.leaveType as StoreLeaveType

  // Balance transitions: leave is created as pending. Approving moves pending→used;
  // rejecting/cancelling clears the reservation (and reverses used if already approved).
  if (nextStatus !== existing.status) {
    if (existing.status === 'pending_hr' && nextStatus === 'approved') {
      // Race-safe: refuse approval if used + this request would exceed entitlement.
      // (This request's days are already in `pending`, so they are not "available".)
      if (leaveType !== 'unpaid') {
        const bal = await getBalance(existing.employeeId, leaveType, year)
        if (bal.used + days > bal.entitlement + bal.carryForward) {
          return NextResponse.json({
            error: `Cannot approve: insufficient ${leaveType} balance (${Math.max(0, bal.entitlement + bal.carryForward - bal.used)} day(s) left against entitlement, ${days} requested)`,
          }, { status: 422 })
        }
      }
      await adjustBalance(existing.employeeId, leaveType, year, { pending: -days, used: +days })
    } else if (existing.status === 'pending_hr' && (nextStatus === 'rejected' || nextStatus === 'cancelled')) {
      await adjustBalance(existing.employeeId, leaveType, year, { pending: -days })
    } else if (existing.status === 'approved' && nextStatus === 'cancelled') {
      await adjustBalance(existing.employeeId, leaveType, year, { used: -days })
    }
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: resolvedParams.id },
    data: {
      status: nextStatus as any,
      reviewedByName: session.user.name,
      reviewedById: null,
      reviewedAt: new Date(),
      reviewNotes: typeof requested.reviewNotes === 'string' ? requested.reviewNotes : undefined,
    },
  })

  await writeFinancialAudit({
    userId: session.user.id,
    action: 'decide_leave',
    entityType: 'leave_request',
    entityId: resolvedParams.id,
    oldValues: { status: existing.status },
    newValues: { status: nextStatus, employeeId: existing.employeeId },
  })

  // Email the applicant after a real approve/decline transition.
  if (
    existing.status === 'pending_hr'
    && (nextStatus === 'approved' || nextStatus === 'rejected')
  ) {
    await publishLeaveDecision(
      updated as any,
      nextStatus === 'approved' ? 'approved' : 'rejected',
      session.user.id,
    )
  }

  return NextResponse.json({ item: toClientRequest(updated as any) })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return PUT(request, { params })
}

// Soft-cancel: leave records are never hard-deleted (they hold approval history).
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.leaveRequest.findUnique({ where: { id: resolvedParams.id } })
  if (!existing) return NextResponse.json({ ok: true })
  if (existing.status === 'approved') {
    const ownEmployee = await prisma.employee.findFirst({ where: { user: { id: session.user.id } }, select: { id: true } }).catch(() => null)
    if (existing.submittedByUserId === session.user.id || (!!ownEmployee?.id && existing.employeeId === ownEmployee.id)) {
      return NextResponse.json({ error: 'Another director or HR officer must cancel your approved leave' }, { status: 403 })
    }
  }

  const year = new Date(existing.startDate).getFullYear()
  const days = Number(existing.daysRequested)
  const leaveType = existing.leaveType as StoreLeaveType
  if (existing.status === 'pending_hr') await adjustBalance(existing.employeeId, leaveType, year, { pending: -days })
  else if (existing.status === 'approved') await adjustBalance(existing.employeeId, leaveType, year, { used: -days })

  const cancelled = await prisma.leaveRequest.update({ where: { id: resolvedParams.id }, data: { status: 'cancelled' as any } })
  await writeFinancialAudit({ userId: session.user.id, action: 'cancel_leave', entityType: 'leave_request', entityId: resolvedParams.id })
  await publishLeaveCancelled(cancelled as any, session.user.id)
  return NextResponse.json({ ok: true })
}
