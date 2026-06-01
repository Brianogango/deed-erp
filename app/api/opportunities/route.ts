import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

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
    await getRequiredSession()
    const opportunities = await prisma.opportunity.findMany({
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
    const body = await request.json()
    const opportunity = await prisma.opportunity.create({
      data: {
        ...mapOpportunityToDb(body),
        createdById: session.user.id,
      },
      include: {
        client: true,
        assignedTo: true,
      }
    })
    return NextResponse.json(opportunity, { status: 201 })
  })
}
