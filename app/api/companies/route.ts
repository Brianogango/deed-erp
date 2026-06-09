import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'

async function broadcastCompanies() {
  try {
    const all = await prisma.client.findMany({ where: { clientType: 'company' }, orderBy: { name: 'asc' } })
    void saveStoreKeys({ deed_companies: JSON.stringify(all) })
  } catch {}
}

function mapCompanyToClient(body: any) {
  return {
    name: body.name,
    email: body.email ?? null,
    phone: body.phone ?? null,
    phoneAlt: body.mobile ?? body.phoneAlt ?? null,
    companyName: body.tradingName ?? body.companyName ?? null,
    kraPin: body.taxId ?? body.vatNumber ?? body.kraPin ?? null,
    idNumber: body.idNumber ?? null,
    addressLine1: body.physicalAddress ?? body.address ?? body.addressLine1 ?? null,
    addressLine2: body.postalAddress ?? body.addressLine2 ?? null,
    city: body.city ?? null,
    country: body.country ?? 'Kenya',
    industry: body.industry ?? null,
    segment: body.segment ?? null,
    employees: body.employees != null ? Number(body.employees) : null,
    tags: Array.isArray(body.tags) ? body.tags : [],
    creditLimit: Number(body.creditLimit ?? 0),
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : body.status !== 'inactive',
    notes: body.notes ?? null,
  }
}

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
