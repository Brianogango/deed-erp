import prisma from '@/lib/prisma'
import { saveStoreKeys } from '@/lib/server-store'

/** Company record mapping shared by the company routes. */

export async function broadcastCompanies() {
  try {
    const all = await prisma.client.findMany({ where: { clientType: 'company' }, orderBy: { name: 'asc' } })
    void saveStoreKeys({ deed_companies: JSON.stringify(all) })
  } catch {}
}

export function mapCompanyToClient(body: any) {
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
