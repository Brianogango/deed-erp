import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, getRequiredSession } from '@/lib/auth/api'
import { canAccessRecord } from '@/lib/auth/authorization'
import { saveStoreKeys } from '@/lib/server-store'

async function broadcastOpportunities() {
  try {
    const all = await prisma.opportunity.findMany({ include: { client: true, assignedTo: true, activities: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_opportunities: JSON.stringify(all) })
  } catch {}
}

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep']

function mapOpportunityToDb(body: any) {
  const data: Record<string, any> = {}
  if (body.clientId ?? body.companyId) data.clientId = body.clientId ?? body.companyId
  if (body.name !== undefined) data.name = body.name
  if (body.description !== undefined) data.description = body.description ?? body.customerNeeds ?? null
  if (body.stage !== undefined) data.stage = body.stage
  if (body.probability !== undefined) data.probability = Number(body.probability)
  if (body.value !== undefined || body.expectedValue !== undefined)
    data.value = Number(body.value ?? body.expectedValue ?? 0)
  if (body.closeDate || body.expectedCloseDate)
    data.closeDate = new Date(body.closeDate ?? body.expectedCloseDate)
  if (body.assignedToId !== undefined || body.ownerId !== undefined)
    data.assignedToId = body.assignedToId ?? body.ownerId ?? null
  return data
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const opp = await prisma.opportunity.findUnique({
      where: { id: params.id },
      include: { client: true, assignedTo: true, activities: true },
    })
    if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canAccessRecord(session.user.role, 'opportunity', {
      ownerId: opp.assignedToId,
      assignedToId: opp.assignedToId,
    }, session.user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(opp)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const opp = await prisma.opportunity.update({
      where: { id: params.id },
      data: mapOpportunityToDb(body),
      include: { client: true, assignedTo: true },
    })
    void broadcastOpportunities()
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
    void broadcastOpportunities()
    return NextResponse.json({ ok: true })
  })
}
