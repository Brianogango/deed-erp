import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { Contact } from '@/lib/store'

export const dynamic = 'force-dynamic'

const STORE_KEY = 'deed_contacts'
const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

const uid = () => Math.random().toString(36).slice(2, 9)
const today = () => new Date().toISOString().slice(0, 10)

type ContactInput = Partial<Omit<Contact, 'id' | 'createdAt'>> & { id?: string; createdAt?: string }

async function readContacts(): Promise<Contact[]> {
  const state = await loadAppState()
  const contacts = state[STORE_KEY]
  return Array.isArray(contacts) ? contacts as Contact[] : []
}

async function writeContacts(contacts: Contact[]): Promise<void> {
  await saveStoreKeys({ [STORE_KEY]: JSON.stringify(contacts) })
}

function normalizeContact(body: ContactInput, existing?: Contact): Contact | string {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return 'Contact name is required'

  const type = body.type === 'individual' ? 'individual' : 'company'

  return {
    ...existing,
    ...body,
    id: existing?.id ?? body.id ?? uid(),
    type,
    name,
    email: body.email ?? existing?.email ?? '',
    phone: body.phone ?? existing?.phone ?? '',
    address: body.address ?? existing?.address ?? '',
    country: body.country ?? existing?.country ?? 'Kenya',
    isCustomer: Boolean(body.isCustomer ?? existing?.isCustomer ?? true),
    isVendor: Boolean(body.isVendor ?? existing?.isVendor ?? false),
    tags: Array.isArray(body.tags) ? body.tags : existing?.tags ?? [],
    creditLimit: Number(body.creditLimit ?? existing?.creditLimit ?? 0) || 0,
    paymentTermsDays: Number(body.paymentTermsDays ?? existing?.paymentTermsDays ?? 30) || 30,
    vendorRating: body.vendorRating === undefined ? existing?.vendorRating : Number(body.vendorRating) || 0,
    loyaltyPoints: Number(body.loyaltyPoints ?? existing?.loyaltyPoints ?? 0) || 0,
    createdAt: existing?.createdAt ?? body.createdAt ?? today(),
  } as Contact
}

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const contacts = await readContacts()
    return NextResponse.json(contacts)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json() as ContactInput
    const contacts = await readContacts()
    const contact = normalizeContact(body)
    if (typeof contact === 'string') {
      return NextResponse.json({ error: contact }, { status: 422 })
    }
    contacts.unshift(contact)
    await writeContacts(contacts)
    return NextResponse.json(contact, { status: 201 })
  })
}
