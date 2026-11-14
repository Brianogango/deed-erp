import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { broadcastCompanies, mapCompanyToClient } from '@/lib/api-shared/companies'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const companies = await prisma.client.findMany({
      where: { clientType: 'company' },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(companies)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    if (!canWriteStoreKey(user, 'deed_companies')) throw Object.assign(new Error('You cannot change companies'), { status: 403 })
    const body = await request.json()
    const company = await prisma.client.create({
      data: {
        clientNumber: `CLT-${Date.now().toString().slice(-8)}`,
        clientType: 'company',
        ...mapCompanyToClient(body),
      },
    })
    void broadcastCompanies()
    return NextResponse.json(company, { status: 201 })
  })
}
