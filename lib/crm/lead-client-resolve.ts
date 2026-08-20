/**
 * Resolve a CRM Client for lead conversion without creating duplicates.
 * Match order: linked clientId → email → phone → company name → corporate domain.
 * Never match on the lead title alone (inbound RFQ subjects are unique per mail).
 */

import { clip, corporateEmailDomain, type LeadIdentity } from '@/lib/crm/lead-convert'

export type LeadClientMatch = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
}

type ClientLookup = {
  client: {
    findUnique: (args: any) => Promise<any | null>
    findFirst: (args: any) => Promise<any | null>
  }
  contactPerson: {
    findFirst: (args: any) => Promise<any | null>
  }
}

function normalizePhoneDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

function toMatch(row: any | null | undefined): LeadClientMatch | null {
  if (!row?.id) return null
  return {
    id: row.id,
    name: String(row.name || '').trim() || 'Customer',
    email: row.email ?? null,
    phone: row.phone ?? null,
  }
}

function withExcludeId<T extends Record<string, unknown>>(
  where: T,
  excludeId?: string,
): T {
  if (!excludeId) return where
  return { ...where, id: { not: excludeId } }
}

export async function findExistingClientForLead(
  prisma: Pick<ClientLookup, 'client'>,
  lead: LeadIdentity,
  opts?: { excludeId?: string },
): Promise<LeadClientMatch | null> {
  const excludeId = opts?.excludeId
  if (lead.clientId && lead.clientId !== excludeId) {
    const linked = await prisma.client.findUnique({
      where: { id: lead.clientId },
      select: { id: true, name: true, email: true, phone: true, isActive: true },
    })
    if (linked && linked.isActive !== false) return toMatch(linked)
  }

  const email = String(lead.email || '').trim().toLowerCase()
  if (email) {
    const byEmail = await prisma.client.findFirst({
      where: withExcludeId(
        { isActive: true, email: { equals: email, mode: 'insensitive' } },
        excludeId,
      ),
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (byEmail) return toMatch(byEmail)
  }

  const phone = normalizePhoneDigits(lead.phone)
  if (phone.length >= 9) {
    const last9 = phone.slice(-9)
    const byPhone = await prisma.client.findFirst({
      where: withExcludeId(
        {
          isActive: true,
          OR: [
            { phone: { contains: last9 } },
            { phoneAlt: { contains: last9 } },
          ],
        },
        excludeId,
      ),
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (byPhone) return toMatch(byPhone)
  }

  const company = String(lead.companyName || '').trim()
  if (company.length >= 2) {
    const byCompany = await prisma.client.findFirst({
      where: withExcludeId(
        {
          isActive: true,
          OR: [
            { name: { equals: company, mode: 'insensitive' } },
            { companyName: { equals: company, mode: 'insensitive' } },
          ],
        },
        excludeId,
      ),
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (byCompany) return toMatch(byCompany)
  }

  const domain = corporateEmailDomain(lead.email)
  if (domain) {
    const byDomain = await prisma.client.findFirst({
      where: withExcludeId(
        {
          isActive: true,
          OR: [
            { email: { endsWith: `@${domain}`, mode: 'insensitive' } },
            { website: { contains: domain, mode: 'insensitive' } },
          ],
        },
        excludeId,
      ),
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (byDomain) return toMatch(byDomain)
  }

  return null
}

export async function findExistingContactPerson(
  prisma: Pick<ClientLookup, 'contactPerson'>,
  opts: { clientId: string; email?: string | null; phone?: string | null },
): Promise<{ id: string } | null> {
  const email = String(opts.email || '').trim()
  if (email) {
    const byEmail = await prisma.contactPerson.findFirst({
      where: { clientId: opts.clientId, email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    })
    if (byEmail) return { id: byEmail.id }
  }
  const phone = clip(opts.phone, 20)
  if (phone && phone.replace(/\D/g, '').length >= 9) {
    const byPhone = await prisma.contactPerson.findFirst({
      where: { clientId: opts.clientId, phone },
      select: { id: true },
    })
    if (byPhone) return { id: byPhone.id }
  }
  return null
}
