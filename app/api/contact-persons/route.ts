import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

function mapContactPersonToDb(body: any) {
  return {
    clientId: body.clientId ?? body.companyId,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email ?? null,
    phone: body.phone ?? null,
    position: body.position ?? body.jobTitle ?? body.department ?? null,
    notes: body.notes ?? null,
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contacts = await prisma.contactPerson.findMany({
      include: { client: true },
      orderBy: { firstName: 'asc' },
    })
    return NextResponse.json(contacts)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const body = await request.json()
    const contact = await prisma.contactPerson.create({
      data: mapContactPersonToDb(body),
      include: { client: true },
    })
    return NextResponse.json(contact, { status: 201 })
  })
}
