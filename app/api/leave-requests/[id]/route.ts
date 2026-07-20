import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import { toClientRequest, adjustBalance } from '@/lib/hr/leave-store'
import type { StoreLeaveType } from '@/lib/leave-utils'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

// Approve / reject / cancel a leave request. Balance counters are recomputed
// server-side from the transition — the client no longer supplies balances.
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await prisma.leaveRequest.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const requested = body.request ?? body
  const nextStatus = String(requested.status ?? existing.status) as 'pending_hr' | 'approved' | 'rejected' | 'cancelled'

  // Nobody may approve or reject their own leave — not even directors/HR.
  // (Cancelling your own request remains allowed.)
  if ((nextStatus === 'approved' || nextStatus === 'rejected') && nextStatus !== existing.status) {
    const ownEmployee = await prisma.employee.findFirst({
      where: { user: { id: session.user.id } },
      select: { id: true },
    }).catch(() => null)
    const isOwn = existing.submittedByUserId === session.user.id || (!!ownEmployee?.id && existing.employeeId === ownEmployee.id)
    if (isOwn) {
      return NextResponse.json({ error: 'You cannot approve or reject your own leave request — another director or HR officer must decide it' }, { status: 403 })
    }
  }
  const year = new Date(existing.startDate).getFullYear()
  const days = Number(existing.daysRequested)
  const leaveType = existing.leaveType as StoreLeaveType

  // Balance transitions: leave is created as pending. Approving moves pending→used;
  // rejecting/cancelling clears the reservation (and reverses used if already approved).
  if (nextStatus !== existing.status) {
    if (existing.status === 'pending_hr' && nextStatus === 'approved') {
      await adjustBalance(existing.employeeId, leaveType, year, { pending: -days, used: +days })
    } else if (existing.status === 'pending_hr' && (nextStatus === 'rejected' || nextStatus === 'cancelled')) {
      await adjustBalance(existing.employeeId, leaveType, year, { pending: -days })
    } else if (existing.status === 'approved' && nextStatus === 'cancelled') {
      await adjustBalance(existing.employeeId, leaveType, year, { used: -days })
    }
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: params.id },
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
    entityId: params.id,
    oldValues: { status: existing.status },
    newValues: { status: nextStatus, employeeId: existing.employeeId },
  })

  return NextResponse.json({ item: toClientRequest(updated as any) })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

// Soft-cancel: leave records are never hard-deleted (they hold approval history).
export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.leaveRequest.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ ok: true })

  const year = new Date(existing.startDate).getFullYear()
  const days = Number(existing.daysRequested)
  const leaveType = existing.leaveType as StoreLeaveType
  if (existing.status === 'pending_hr') await adjustBalance(existing.employeeId, leaveType, year, { pending: -days })
  else if (existing.status === 'approved') await adjustBalance(existing.employeeId, leaveType, year, { used: -days })

  await prisma.leaveRequest.update({ where: { id: params.id }, data: { status: 'cancelled' as any } })
  await writeFinancialAudit({ userId: session.user.id, action: 'cancel_leave', entityType: 'leave_request', entityId: params.id })
  return NextResponse.json({ ok: true })
}
