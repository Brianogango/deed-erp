import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { activityExtras, toScreenActivity } from '@/lib/opportunity-activity-read-model.server'

/** Open tabs re-read activities from the table (the deed_oppActivities copy is frozen). */
const broadcastOppActivities = () => notifyStoreKeysChanged(['deed_oppActivities'])

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
    await getRequiredSession()
    const activities = await prisma.opportunityActivity.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(activities.map(toScreenActivity))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

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
