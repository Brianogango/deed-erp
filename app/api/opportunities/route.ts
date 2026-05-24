import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const opportunities = await prisma.opportunity.findMany({
      include: {
        client: true,
        assignee: true,
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
        ...body,
        createdById: session.user.id,
      },
      include: {
        client: true,
        assignee: true,
      }
    })
    return NextResponse.json(opportunity, { status: 201 })
  })
}
