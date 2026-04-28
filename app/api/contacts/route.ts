import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contacts = await prisma.contact.findMany({ orderBy: { createdDate: 'desc' } })
    return NextResponse.json(contacts)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const contact = await prisma.contact.create({ data: body })
    return NextResponse.json(contact, { status: 201 })
  })
}
