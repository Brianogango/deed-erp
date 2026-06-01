import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'

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

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const activity = await prisma.opportunityActivity.update({
      where: { id: params.id },
      data: mapActivityToDb(body),
    })
    return NextResponse.json(activity)
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.opportunityActivity.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  })
}
