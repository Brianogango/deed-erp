import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'
import { isRoleAllowed } from '@/lib/auth/authorization'
import {
  CONTACT_PERSON_SELECT,
  contactPersonFromDb,
  contactPersonToDb,
} from '@/lib/contact-person-map'

export const CONTACT_PERSON_WRITE_ROLES = [
  'director', 'admin_officer', 'sales_rep', 'technical_lead', 'technician',
]

/**
 * Push the contact-person list into app_state for the browser store.
 *
 * This used to `include: { client: true }`, embedding the entire client record
 * inside every contact person — a large blob for something the UI only needs a
 * name from, and one more thing filling the localStorage quota. It also wrote
 * raw Prisma rows, whose field names the app does not use.
 */
export async function broadcastContactPersons() {
  try {
    const all = await prisma.contactPerson.findMany({
      select: CONTACT_PERSON_SELECT,
      orderBy: { firstName: 'asc' },
    })
    await saveStoreKeys({ deed_contactPersons: JSON.stringify(all.map(contactPersonFromDb)) })
  } catch (error) {
    console.error('[contact-persons] broadcast failed:', error)
  }
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contacts = await prisma.contactPerson.findMany({
      select: CONTACT_PERSON_SELECT,
      orderBy: { firstName: 'asc' },
    })
    return NextResponse.json(contacts.map(contactPersonFromDb))
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    // This route had no role check at all while PUT and DELETE required one,
    // so anyone could create a contact person they could not then correct.
    // Roles are normalized so `lead_tech` / `repair_tech` are not locked out;
    // repair intake creates contact persons too.
    if (!isRoleAllowed(session.user.role, CONTACT_PERSON_WRITE_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const data = contactPersonToDb(body, { includeId: true })
    if (typeof data === 'string') {
      return NextResponse.json({ error: data }, { status: 422 })
    }

    const contact = await prisma.contactPerson.create({
      data: data as any,
      select: CONTACT_PERSON_SELECT,
    })
    await broadcastContactPersons()
    return NextResponse.json(contactPersonFromDb(contact), { status: 201 })
  })
}
