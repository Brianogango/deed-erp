import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep']

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const opp = await prisma.opportunity.findUnique({
      where: { id: params.id },
      include: { client: true, assignedTo: true, activities: true },
    })
    if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(opp)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { id: _id, client, assignedTo, activities, ...rest } = body
    Object.keys(rest).forEach(k => rest[k] === undefined && delete rest[k])
    if (rest.expectedCloseDate) rest.expectedCloseDate = new Date(rest.expectedCloseDate)

    const opp = await prisma.opportunity.update({
      where: { id: params.id },
      data: rest,
      include: { client: true, assignedTo: true },
    })
    return NextResponse.json(opp)
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.opportunity.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  })
}
