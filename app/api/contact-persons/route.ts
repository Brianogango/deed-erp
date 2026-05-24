import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contacts = await prisma.contactPerson.findMany({
      include: {
        client: true,
      },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(contacts)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const body = await request.json()
    
    const contact = await prisma.contactPerson.create({
      data: {
        ...body,
      },
      include: {
        client: true,
      }
    })
    return NextResponse.json(contact, { status: 201 })
  })
}
