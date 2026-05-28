import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep']

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { id: _id, createdBy, opportunity, ...rest } = body
    Object.keys(rest).forEach(k => rest[k] === undefined && delete rest[k])

    const activity = await prisma.opportunityActivity.update({
      where: { id: params.id },
      data: rest,
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
