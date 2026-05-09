import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

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
    await getRequiredSession()
    const body = await request.json()
    // Strip old Company fields not present on Client
    const { createdDate, lastContactDate, contactPersons, registrationNumber,
            industry, employees, annualRevenue, segment, tags, parentCompanyId,
            accountManagerId, accountManagerName, postalAddress, ...rest } = body
    const company = await prisma.client.create({
      data: {
        clientNumber: `CLT-${Date.now().toString().slice(-8)}`,
        clientType: 'company',
        ...rest,
      },
    })
    return NextResponse.json(company, { status: 201 })
  })
}
