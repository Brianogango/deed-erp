import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['admin', 'sales', 'finance']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const clients = await prisma.client.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(clients)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    // Strip fields from old Contact schema that don't exist on Client
    const { createdDate, lastContactDate, isCustomer, isVendor, taxId, type, ...rest } = body
    const client = await prisma.client.create({
      data: {
        clientNumber: `CLT-${Date.now().toString().slice(-8)}`,
        ...rest,
      },
    })
    return NextResponse.json(client, { status: 201 })
  })
}
