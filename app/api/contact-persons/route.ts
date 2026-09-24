import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { clientToContact } from '@/lib/contact-prisma'
import { deriveContactPersons } from '@/lib/contact-person-derive'

// NOTE: companyId/jobTitle are declared on Client in prisma/schema.prisma
// (migration 010). The narrow casts below let this compile against a Prisma
// client generated before that change as well as after it; the field names
// were checked against the schema directly.

export const dynamic = 'force-dynamic'

/**
 * Compatibility shim — read only.
 *
 * A contact person is an individual contact with an employer, so they live in
 * the contacts directory (`clients`) like everyone else. The contact_persons
 * table this route used to own was a second store for the same concept, and no
 * other screen read it: a person added on the company form never appeared on
 * that company's detail panel, which filtered the directory instead.
 *
 * Writes now go through the contacts API. This endpoint stays only so any
 * caller not yet updated keeps reading sensible data, and should be deleted
 * once nothing calls it.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const clients = await prisma.client.findMany({
      where: { clientType: 'individual', companyId: { not: null }, isActive: true } as any,
      orderBy: { name: 'asc' },
    })
    const companies = await prisma.client.findMany({
      where: { id: { in: clients.map(c => (c as any).companyId as string).filter(Boolean) } },
      select: { id: true, name: true, companyName: true },
    })
    const nameById = new Map(companies.map(c => [c.id, c.companyName || c.name]))
    return NextResponse.json(
      deriveContactPersons(clients.map(clientToContact), id => nameById.get(id)),
    )
  })
}

const GONE = {
  error: 'Contact persons are saved as contacts now. Use /api/contacts with type "individual" and a companyId.',
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 })
}
