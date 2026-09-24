import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { isUUID } from '@/lib/utils'
import {
  CONTACT_PERSON_SELECT,
  contactPersonFromDb,
  contactPersonToDb,
} from '@/lib/contact-person-map'
import { CONTACT_PERSON_WRITE_ROLES, broadcastContactPersons } from '../route'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    if (!isUUID(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const contact = await prisma.contactPerson.findUnique({
      where: { id: params.id },
      select: CONTACT_PERSON_SELECT,
    })
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(contactPersonFromDb(contact))
  })
}

async function write(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!isRoleAllowed(session.user.role, CONTACT_PERSON_WRITE_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // A non-uuid id is a 404, not an `invalid input syntax for type uuid` 500.
    if (!isUUID(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    // Partial: an edit that sends one field must not blank the rest.
    const data = contactPersonToDb(body, { partial: true })
    if (typeof data === 'string') {
      return NextResponse.json({ error: data }, { status: 422 })
    }

    const existing = await prisma.contactPerson.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    // The browser used to mint an id the server never stored, so this update
    // addressed a row that did not exist and answered 500 — which the client's
    // fire-and-forget sync discarded while still toasting "updated". Creating
    // the row here means an edit made before the original create landed still
    // ends with the record saved under the id the open screen is holding.
    if (!existing) {
      const createData = contactPersonToDb({ ...body, id: params.id }, { includeId: true })
      if (typeof createData === 'string') {
        return NextResponse.json({ error: createData }, { status: 404 })
      }
      const created = await prisma.contactPerson.create({
        data: createData as any,
        select: CONTACT_PERSON_SELECT,
      })
      await broadcastContactPersons()
      return NextResponse.json(contactPersonFromDb(created), { status: 201 })
    }

    const contact = await prisma.contactPerson.update({
      where: { id: params.id },
      data: data as any,
      select: CONTACT_PERSON_SELECT,
    })
    await broadcastContactPersons()
    return NextResponse.json(contactPersonFromDb(contact))
  })
}

export const PUT = write
export const PATCH = write

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!isRoleAllowed(session.user.role, CONTACT_PERSON_WRITE_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!isUUID(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const existing = await prisma.contactPerson.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    // Already gone is the outcome the caller wanted; a 500 here just made a
    // delete look like it failed after it had already been removed locally.
    if (!existing) return NextResponse.json({ ok: true, deleted: 0 })

    await prisma.contactPerson.delete({ where: { id: params.id } })
    await broadcastContactPersons()
    return NextResponse.json({ ok: true, deleted: 1 })
  })
}
