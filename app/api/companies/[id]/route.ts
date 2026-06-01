import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

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

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const body = await request.json()
    const client = await prisma.client.update({
      where: { id: params.id },
      data: mapCompanyToClient(body),
    })
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
