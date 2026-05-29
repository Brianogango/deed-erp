import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    
    const activities = await prisma.opportunityActivity.findMany({
      orderBy: { createdAt: 'desc' }
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
        ...body,
        createdById: session.user.id,
      }
    })
    
    // Also update the opportunity's updatedAt field
    await prisma.opportunity.update({
      where: { id: body.opportunityId },
      data: { updatedAt: new Date() }
    })
    
    return NextResponse.json(activity, { status: 201 })
  })
}
