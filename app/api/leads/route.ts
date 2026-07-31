import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

const LEAD_INCLUDE = {
  owner: { select: { id: true, username: true, email: true } },
  client: true,
  opportunity: true,
} as const

const WRITE_ROLES = ['director', 'admin_officer', 'sales_rep', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const leads = await prisma.lead.findMany({
      include: LEAD_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(leads)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await request.json()
    const lead = await prisma.lead.create({
      data: {
        name: String(body.name || '').trim(),
        companyName: body.companyName?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        source: body.source?.trim() || null,
        stage: body.stage ?? 'new',
        ownerId: body.ownerId ?? session.user.id,
        clientId: body.clientId ?? null,
        notes: body.notes ?? null,
      },
      include: LEAD_INCLUDE,
    })
    return NextResponse.json(lead, { status: 201 })
  })
}
