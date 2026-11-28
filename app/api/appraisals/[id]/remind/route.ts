import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'
import { publishNotificationEvent } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/appraisals/[id]/remind — HR nudges whoever the review is waiting
 * on: the employee for their self review, the manager for theirs. An in-app
 * notice to the person's login; says so when they have none.
 */
export async function POST(_: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requirePermission('manageHR')
    const { id } = await resolveRouteParams(params)
    const row = await prisma.appraisal.findUnique({
      where: { id },
      select: { id: true, status: true, cycle: { select: { name: true, periodEnd: true } }, employee: { select: { id: true, firstName: true, lastName: true, managerId: true, user: { select: { id: true } } } } },
    })
    if (!row) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    if (row.status === 'completed') return NextResponse.json({ error: 'This review is already done' }, { status: 409 })
    const name = `${row.employee.firstName} ${row.employee.lastName}`.trim()
    let userId: string | null = null
    let who = name
    if (row.status === 'pending_self') userId = row.employee.user?.id ?? null
    else if (row.employee.managerId) {
      const mgr = await prisma.employee.findUnique({ where: { id: row.employee.managerId }, select: { firstName: true, lastName: true, user: { select: { id: true } } } })
      userId = mgr?.user?.id ?? null
      who = mgr ? `${mgr.firstName} ${mgr.lastName}`.trim() : 'their manager'
    }
    if (!userId) return NextResponse.json({ error: `${who} has no login to remind` }, { status: 422 })
    await publishNotificationEvent({
      eventType: 'hr.review.reminder',
      entityType: 'appraisal',
      entityId: row.id,
      userIds: [userId],
      title: row.status === 'pending_self' ? 'Your self review is waiting' : `${name}'s review is waiting for you`,
      body: `${row.cycle.name}${row.cycle.periodEnd ? ` · due ${row.cycle.periodEnd.toISOString().slice(0, 10)}` : ''}`,
      actionUrl: '/hr?tab=performance',
      idempotencyKey: `hr-review-remind:${row.id}:${new Date().toISOString().slice(0, 13)}`,
    })
    return NextResponse.json({ ok: true, reminded: who })
  })
}
