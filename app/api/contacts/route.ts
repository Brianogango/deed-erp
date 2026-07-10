import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { listContactClients, upsertContact, type ContactInput } from '@/lib/contact-prisma'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const searchParams = new URL(request.url).searchParams
    const result = await listContactClients(prisma, searchParams)
    if (result.paginated) {
      const { contacts, total, page, limit } = result
      return NextResponse.json({ items: contacts, total, page, limit })
    }
    return NextResponse.json(result.contacts)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json() as ContactInput
    const result = await upsertContact(prisma, body)
    if (typeof result === 'string') {
      return NextResponse.json({ error: result }, { status: 422 })
    }
    return NextResponse.json(result.contact, { status: result.created ? 201 : 200 })
  })
}
