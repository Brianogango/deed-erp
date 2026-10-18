import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { normalizePermissionRole } from '@/lib/auth/authorization'
import { normalizeOpportunityForClient } from '@/lib/opportunity-normalization'
import { clientOpportunityId, opportunityExtras } from '@/lib/opportunity-extras'
import { broadcastOpportunities, opportunityRef, OPPORTUNITY_INCLUDE } from '@/lib/opportunity-server'

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
    // Keep the browser's id. The table used to give every new deal an id of
    // its own, so the browser's later edits, activities and quotations all
    // pointed at a deal the server did not have.
    const id = clientOpportunityId(body)
    if (id) {
      const existing = await prisma.opportunity.findUnique({ where: { id }, include: OPPORTUNITY_INCLUDE })
      if (existing) return NextResponse.json(normalizeOpportunityForClient(existing))
    }
    const extras = opportunityExtras(body)
    extras.ref = await opportunityRef(extras.ref)
    const opportunity = await prisma.opportunity.create({
      data: {
        ...(id ? { id } : {}),
        ...mapOpportunityToDb(body),
        ...(role === 'sales_rep' ? { assignedToId: session.user.id } : {}),
        screenExtras: extras as object,
        createdById: session.user.id,
      },
      include: OPPORTUNITY_INCLUDE,
    })
    void broadcastOpportunities()
    return NextResponse.json(normalizeOpportunityForClient(opportunity), { status: 201 })
  })
}
