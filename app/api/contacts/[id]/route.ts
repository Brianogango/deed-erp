import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { Contact } from '@/lib/store'

export const dynamic = 'force-dynamic'

const STORE_KEY = 'deed_contacts'
const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

type ContactInput = Partial<Omit<Contact, 'id'>>

async function readContacts(): Promise<Contact[]> {
  const state = await loadAppState()
  const contacts = state[STORE_KEY]
  return Array.isArray(contacts) ? contacts as Contact[] : []
}

async function writeContacts(contacts: Contact[]): Promise<void> {
  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(contacts) })
}

function normalizeContactUpdate(existing: Contact, body: ContactInput): Contact | string {
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name
  if (!nextName) return 'Contact name is required'

  return {
    ...existing,
    ...body,
    id: existing.id,
    name: nextName,
    type: body.type === 'individual' ? 'individual' : body.type === 'company' ? 'company' : existing.type,
    country: body.country ?? existing.country ?? 'Kenya',
    isCustomer: Boolean(body.isCustomer ?? existing.isCustomer ?? true),
    isVendor: Boolean(body.isVendor ?? existing.isVendor ?? false),
    tags: Array.isArray(body.tags) ? body.tags : existing.tags ?? [],
    creditLimit: Number(body.creditLimit ?? existing.creditLimit ?? 0) || 0,
    paymentTermsDays: Number(body.paymentTermsDays ?? existing.paymentTermsDays ?? 30) || 30,
    vendorRating: body.vendorRating === undefined ? existing.vendorRating : Number(body.vendorRating) || 0,
    loyaltyPoints: Number(body.loyaltyPoints ?? existing.loyaltyPoints ?? 0) || 0,
    updatedAt: new Date().toISOString(),
  } as Contact
}

async function updateContact(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json() as ContactInput
    const contacts = await readContacts()
    const idx = contacts.findIndex(contact => contact.id === params.id)
    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = normalizeContactUpdate(contacts[idx], body)
    if (typeof updated === 'string') {
      return NextResponse.json({ error: updated }, { status: 422 })
    }

    contacts[idx] = updated
    await writeContacts(contacts)
    return NextResponse.json(updated)
  })
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contacts = await readContacts()
    const contact = contacts.find(item => item.id === params.id)
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(contact)
  })
}

export const PATCH = updateContact
export const PUT = updateContact

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const contacts = await readContacts()
    const remaining = contacts.filter(contact => contact.id !== params.id)
    if (remaining.length === contacts.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await writeContacts(remaining)
    return NextResponse.json({ ok: true })
  })
}
