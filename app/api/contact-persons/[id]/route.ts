import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isUUID } from '@/lib/utils'
import { clientToContact } from '@/lib/contact-prisma'
import { deriveContactPersons } from '@/lib/contact-person-derive'

// NOTE: companyId/jobTitle are declared on Client in prisma/schema.prisma
// (migration 010). The narrow casts below let this compile against a Prisma
// client generated before that change as well as after it; the field names
// were checked against the schema directly.

export const dynamic = 'force-dynamic'

/**
 * Compatibility shim — read only. See ../route.ts: a contact person is an
 * individual contact with an employer, so writes go through /api/contacts.
 * Ids were preserved by migration 010, so a lookup by the old contact-person
 * id still finds the right person.
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    if (!isUUID(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const client = await prisma.client.findUnique({ where: { id: params.id } })
    const employerId = client ? (client as any).companyId as string | null : null
    if (!client || client.clientType !== 'individual' || !employerId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const company = await prisma.client.findUnique({
      where: { id: employerId },
      select: { name: true, companyName: true },
    })
    const [person] = deriveContactPersons(
      [clientToContact(client)],
      () => company?.companyName || company?.name,
    )
    if (!person) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(person)
  })
}

const GONE = {
  error: 'Contact persons are saved as contacts now. Use /api/contacts/<id>.',
}

export async function PUT() { return NextResponse.json(GONE, { status: 410 }) }
export async function PATCH() { return NextResponse.json(GONE, { status: 410 }) }
export async function DELETE() { return NextResponse.json(GONE, { status: 410 }) }
