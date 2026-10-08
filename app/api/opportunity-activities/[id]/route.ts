import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'
import { notifyStoreKeysChanged } from '@/lib/server-store'
import { activityExtras, toScreenActivity } from '@/lib/opportunity-activity-read-model.server'

/** Open tabs re-read activities from the table (the deed_oppActivities copy is frozen). */
const broadcastOppActivities = () => notifyStoreKeysChanged(['deed_oppActivities'])

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep']

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
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const existing = await prisma.opportunityActivity.findUnique({ where: { id: resolvedParams.id } })
    if (!existing) return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
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
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.opportunityActivity.delete({ where: { id: resolvedParams.id } })
    await broadcastOppActivities()
    return NextResponse.json({ ok: true })
  })
}
