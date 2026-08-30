import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { normalizePermissionRole } from '@/lib/auth/authorization'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeOpportunitiesForClient } from '@/lib/opportunity-normalization'

const OPP_INCLUDE = { client: true, assignedTo: true, activities: true } as const

async function broadcastOpportunities() {
  try {
    const all = await prisma.opportunity.findMany({ include: OPP_INCLUDE, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_opportunities: JSON.stringify(normalizeOpportunitiesForClient(all)) })
  } catch {}
}

function mapOpportunityToDb(body: any) {
  return {
    clientId: body.clientId ?? body.companyId,
    name: body.name,
    description: body.description ?? body.customerNeeds ?? null,
    stage: body.stage ?? 'new',
    probability: Number(body.probability ?? 0),
    value: Number(body.value ?? body.expectedValue ?? 0),
    closeDate: body.closeDate
      ? new Date(body.closeDate)
      : body.expectedCloseDate
        ? new Date(body.expectedCloseDate)
        : null,
    assignedToId: body.assignedToId ?? body.ownerId ?? null,
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const role = normalizePermissionRole(session.user.role)
    if (!role || !['director', 'admin_officer', 'finance_officer', 'kilimall_officer', 'technical_lead', 'sales_rep'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const opportunities = await prisma.opportunity.findMany({
      where: role === 'sales_rep'
        ? {
            OR: [
              { createdById: session.user.id },
              { assignedToId: session.user.id },
            ],
          }
        : undefined,
      include: {
        client: true,
        assignedTo: true,
        activities: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(opportunities)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const role = normalizePermissionRole(session.user.role)
    if (!role || !['director', 'admin_officer', 'sales_rep'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()
    const opportunity = await prisma.opportunity.create({
      data: {
        ...mapOpportunityToDb(body),
        ...(role === 'sales_rep' ? { assignedToId: session.user.id } : {}),
        createdById: session.user.id,
      },
      include: {
        client: true,
        assignedTo: true,
      }
    })
    void broadcastOpportunities()
    return NextResponse.json(opportunity, { status: 201 })
  })
}
