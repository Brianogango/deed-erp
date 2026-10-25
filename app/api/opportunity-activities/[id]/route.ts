import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { activityExtras, toScreenActivity } from '@/lib/opportunity-activity-read-model.server'
import { canAccessRecord, isRoleAllowed } from '@/lib/auth/authorization'

/** Open tabs re-read activities from the table (the deed_oppActivities copy is frozen). */
const broadcastOppActivities = () => notifyStoreKeysChanged(['deed_oppActivities'])

// Same people who can edit deals (app/api/opportunities/[id]); a rep only on
// deals they created or are assigned to.
const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep']

async function canWriteDealActivity(user: { id: string; role: string }, opportunityId: unknown): Promise<boolean> {
  if (!isRoleAllowed(user.role, WRITE_ROLES)) return false
  if (typeof opportunityId !== 'string' || !opportunityId) return false
  const deal = await prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { createdById: true, assignedToId: true } }).catch(() => null)
  if (!deal) return false
  return canAccessRecord(user.role, 'opportunity', { ownerId: deal.createdById, assignedToId: deal.assignedToId }, user.id)
}

function mapActivityToDb(body: any) {
  const data: Record<string, any> = {}
  if (body.opportunityId !== undefined) data.opportunityId = body.opportunityId
  if (body.type !== undefined) data.type = body.type
  if (body.description !== undefined || body.subject !== undefined)
    data.description = body.description ?? body.subject ?? null
  if (body.scheduledAt !== undefined || body.scheduledDate !== undefined)
    data.scheduledAt = body.scheduledAt
      ? new Date(body.scheduledAt)
      : body.scheduledDate
        ? new Date(body.scheduledDate)
        : null
  return data
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const existing = await prisma.opportunityActivity.findUnique({ where: { id: resolvedParams.id } })
    if (!existing) return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    // The caller must be able to edit the deal the activity is on, and the
    // deal it is being moved to.
    if (!await canWriteDealActivity(session.user, existing.opportunityId)
      || (body.opportunityId !== undefined && body.opportunityId !== existing.opportunityId && !await canWriteDealActivity(session.user, body.opportunityId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const activity = await prisma.opportunityActivity.update({
      where: { id: resolvedParams.id },
      data: { ...mapActivityToDb(body), screenExtras: activityExtras(body, existing.screenExtras) },
    })
    await broadcastOppActivities()
    return NextResponse.json(toScreenActivity(activity))
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const existing = await prisma.opportunityActivity.findUnique({ where: { id: resolvedParams.id }, select: { opportunityId: true } })
    if (!existing) return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    if (!await canWriteDealActivity(session.user, existing.opportunityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.opportunityActivity.delete({ where: { id: resolvedParams.id } })
    await broadcastOppActivities()
    return NextResponse.json({ ok: true })
  })
}
