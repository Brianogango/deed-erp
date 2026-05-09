import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const id = params.id
    const body = await request.json()
    // Strip old ContactPerson / Company fields not present on Client
    const { createdDate, lastContactDate, companyId, companyName: _cn,
            fullName, isPrimary, isDecisionMaker, isBillingContact,
            isTechnicalContact, preferredChannel, linkedIn, ...rest } = body
    const client = await prisma.client.update({ where: { id }, data: rest })
    return NextResponse.json(client)
  })
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    await prisma.client.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  })
}
