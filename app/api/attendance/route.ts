import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { AttendanceError, listDays, listPayBasis, monthLocked, reviewDay } from '@/lib/hr/attendance.server'
import { monthRange, nairobiDate, type AttendanceStatus } from '@/lib/hr/attendance-core'

export const dynamic = 'force-dynamic'

/** Every day clocked in a month (?month=2026-11), each employee's pay basis, and whether payroll has closed the month. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('manageHR')
    const month = new URL(request.url).searchParams.get('month') || nairobiDate().slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) throw new AttendanceError('Pick a month')
    const [days, payBasis, lockedBy] = await Promise.all([listDays(monthRange(month)), listPayBasis(), monthLocked(`${month}-01`)])
    return NextResponse.json({ month, days, payBasis, lockedBy }, { headers: { 'Cache-Control': 'no-store' } })
  })
}

/** A supervisor adds, corrects, approves or rejects a day. A reason is required. */
export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageHR')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const status = ['approved', 'pending', 'rejected'].includes(String(body.status)) ? body.status as AttendanceStatus : undefined
    const time = (v: unknown) => (v === undefined ? undefined : v ? String(v) : null)
    const day = await reviewDay({
      employeeId: String(body.employeeId ?? ''),
      workDate: String(body.workDate ?? ''),
      clockIn: time(body.clockIn),
      clockOut: time(body.clockOut),
      status,
      reason: String(body.reason ?? ''),
      actorName: actor.name || actor.username,
    })
    return NextResponse.json({ day })
  })
}
