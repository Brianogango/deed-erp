import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { activityExtras, toScreenActivity } from '@/lib/opportunity-activity-read-model.server'
import { canAccessRecord, filterStoreValueForRole, isRoleAllowed } from '@/lib/auth/authorization'

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
  return {
    opportunityId: body.opportunityId,
    type: body.type,
    description: body.description ?? body.subject ?? null,
    scheduledAt: body.scheduledAt
      ? new Date(body.scheduledAt)
      : body.scheduledDate
        ? new Date(body.scheduledDate)
        : null,
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const activities = await prisma.opportunityActivity.findMany({
      orderBy: { createdAt: 'desc' },
      include: { opportunity: { select: { assignedToId: true, createdById: true } } },
    })
    return NextResponse.json(filterStoreValueForRole(session.user, 'deed_oppActivities', activities.map(toScreenActivity)))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    if (!await canWriteDealActivity(session.user, body?.opportunityId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Keep the browser's id, so later edits (completing it) find the row.
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : undefined
    const existing = id ? await prisma.opportunityActivity.findUnique({ where: { id } }) : null
    if (existing) return NextResponse.json(toScreenActivity(existing))
    const activity = await prisma.opportunityActivity.create({
      data: {
        ...(id ? { id } : {}),
        ...mapActivityToDb(body),
        screenExtras: activityExtras(body),
        createdById: session.user.id,
      }
    })

    await prisma.opportunity.update({
      where: { id: body.opportunityId },
      data: { updatedAt: new Date() }
    })

    await broadcastOppActivities()
    return NextResponse.json(toScreenActivity(activity), { status: 201 })
  })
}
