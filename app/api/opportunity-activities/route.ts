import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'

async function broadcastOppActivities() {
  try {
    const all = await prisma.opportunityActivity.findMany({ orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_oppActivities: JSON.stringify(all) })
  } catch {}
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
    await getRequiredSession()
    const activities = await prisma.opportunityActivity.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(activities)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

    const activity = await prisma.opportunityActivity.create({
      data: {
        ...mapActivityToDb(body),
        createdById: session.user.id,
      }
    })

    await prisma.opportunity.update({
      where: { id: body.opportunityId },
      data: { updatedAt: new Date() }
    })

    void broadcastOppActivities()
    return NextResponse.json(activity, { status: 201 })
  })
}
