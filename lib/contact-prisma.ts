import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { Contact } from '@/lib/store'

export const CONTACT_STORE_KEY = 'deed_contacts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i

type PrismaClientLike = {
  client: {
    count: (args?: any) => Promise<number>
    findMany: (args?: any) => Promise<any[]>
    findFirst: (args: any) => Promise<any | null>
    findUnique: (args: any) => Promise<any | null>
    create: (args: any) => Promise<any>
    update: (args: any) => Promise<any>
    delete: (args: any) => Promise<any>
  }
  /** Present on the real Prisma client; absent on lightweight test doubles. */
  $transaction?: (fn: (tx: PrismaClientLike) => Promise<any>) => Promise<any>
  $executeRawUnsafe?: (query: string, ...values: unknown[]) => Promise<number>
}

export type ContactInput = Partial<Omit<Contact, 'id' | 'createdAt'>> & {
  id?: string
  createdAt?: string
  companyName?: string
  kraPin?: string
  taxId?: string
  addressLine1?: string
  addressLine2?: string
  physicalAddress?: string
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function cleanTextOrEmpty(value: unknown, fallback = ''): string {
  return cleanText(value) ?? fallback
}

function numberOr(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function tagsFrom(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : fallback
}

function asDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' && value) return value.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

function clientNumber() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-7)
  const rand = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')
  return `CLT-${stamp}${rand}`.slice(0, 20)
}

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function clientToContact(client: any): Contact {
  const paymentTermsDays = numberOr(client.paymentTermsDays, 30)
  return {
    id: client.id,
    type: client.clientType === 'individual' ? 'individual' : 'company',
    name: client.name,
    tradingName: client.companyName ?? undefined,
    registrationNumber: client.registrationNumber ?? undefined,
    vatNumber: client.kraPin ?? undefined,
    idNumber: client.idNumber ?? undefined,
    email: client.email ?? '',
    phone: client.phone ?? '',
    mobile: client.phoneAlt ?? undefined,
    website: client.website ?? undefined,
    address: client.addressLine1 ?? '',
    postalAddress: client.addressLine2 ?? undefined,
    city: client.city ?? undefined,
    country: client.country ?? 'Kenya',
    isCustomer: client.isCustomer ?? true,
    isVendor: client.isVendor ?? false,
    industry: client.industry ?? undefined,
    tags: tagsFrom(client.tags),
    creditLimit: numberOr(client.creditLimit, 0),
    paymentTermsDays,
    paymentTerms: `${paymentTermsDays} days`,
    bankName: client.bankName ?? undefined,
    bankAccount: client.bankAccount ?? undefined,
    bankBranch: client.bankBranch ?? undefined,
    notes: client.notes ?? undefined,
    vendorRating: numberOr(client.vendorRating, 0),
    loyaltyPoints: numberOr(client.loyaltyPoints, 0),
    createdAt: dateOnly(client.createdAt),
    isArchived: client.isActive === false,
  }
}

export function normalizeContact(body: ContactInput, existing?: Contact): Contact | string {
  const name = cleanText(body.name) ?? existing?.name ?? ''
  if (!name) return 'Contact name is required'

  const type = body.type === 'individual'
    ? 'individual'
    : body.type === 'company'
      ? 'company'
      : existing?.type ?? 'company'

  return {
    ...existing,
    ...body,
    id: existing?.id ?? body.id ?? '',
    type,
    name,
    tradingName: cleanText(body.tradingName ?? body.companyName) ?? existing?.tradingName,
    registrationNumber: cleanText(body.registrationNumber) ?? existing?.registrationNumber,
    vatNumber: cleanText(body.vatNumber ?? body.kraPin ?? body.taxId) ?? existing?.vatNumber,
    idNumber: cleanText(body.idNumber) ?? existing?.idNumber,
    email: cleanTextOrEmpty(body.email, existing?.email ?? ''),
    phone: cleanTextOrEmpty(body.phone, existing?.phone ?? ''),
    mobile: cleanText(body.mobile) ?? existing?.mobile,
    website: cleanText(body.website) ?? existing?.website,
    address: cleanTextOrEmpty(body.address ?? body.physicalAddress ?? body.addressLine1, existing?.address ?? ''),
    postalAddress: cleanText(body.postalAddress ?? body.addressLine2) ?? existing?.postalAddress,
    city: cleanText(body.city) ?? existing?.city,
    country: cleanText(body.country) ?? existing?.country ?? 'Kenya',
    isCustomer: body.isCustomer === undefined ? existing?.isCustomer ?? true : Boolean(body.isCustomer),
    isVendor: body.isVendor === undefined ? existing?.isVendor ?? false : Boolean(body.isVendor),
    industry: cleanText(body.industry) ?? existing?.industry,
    tags: tagsFrom(body.tags, existing?.tags ?? []),
    creditLimit: numberOr(body.creditLimit, existing?.creditLimit ?? 0),
    paymentTermsDays: numberOr(body.paymentTermsDays, existing?.paymentTermsDays ?? 30),
    bankName: cleanText(body.bankName) ?? existing?.bankName,
    bankAccount: cleanText(body.bankAccount) ?? existing?.bankAccount,
    bankBranch: cleanText(body.bankBranch) ?? existing?.bankBranch,
    notes: cleanText(body.notes) ?? existing?.notes,
    vendorRating: body.vendorRating === undefined ? existing?.vendorRating : numberOr(body.vendorRating, 0),
    loyaltyPoints: numberOr(body.loyaltyPoints, existing?.loyaltyPoints ?? 0),
    createdAt: existing?.createdAt ?? body.createdAt ?? dateOnly(undefined),
  }
}

export function contactToClientData(contact: Contact, includeCreateFields = false): Record<string, unknown> {
  return {
    ...(includeCreateFields && isUuid(contact.id) ? { id: contact.id } : {}),
    ...(includeCreateFields ? { clientNumber: clientNumber(), createdAt: asDate(contact.createdAt) } : {}),
    clientType: contact.type,
    name: contact.name,
    companyName: contact.tradingName ?? null,
    registrationNumber: contact.registrationNumber ?? null,
    kraPin: contact.vatNumber ?? null,
    idNumber: contact.idNumber ?? null,
    email: contact.email || null,
    phone: contact.phone || null,
    phoneAlt: contact.mobile ?? null,
    website: contact.website ?? null,
    addressLine1: contact.address || null,
    addressLine2: contact.postalAddress ?? null,
    city: contact.city ?? null,
    country: contact.country ?? 'Kenya',
    isCustomer: contact.isCustomer,
    isVendor: contact.isVendor,
    industry: contact.industry ?? null,
    tags: contact.tags,
    creditLimit: contact.creditLimit ?? 0,
    paymentTermsDays: contact.paymentTermsDays ?? 30,
    bankName: contact.bankName ?? null,
    bankAccount: contact.bankAccount ?? null,
    bankBranch: contact.bankBranch ?? null,
    notes: contact.notes ?? null,
    vendorRating: contact.vendorRating ?? 0,
    loyaltyPoints: contact.loyaltyPoints ?? 0,
    isActive: true,
  }
}

export async function findExistingContact(prisma: PrismaClientLike, body: ContactInput): Promise<any | null> {
  if (isUuid(body.id)) {
    const byId = await prisma.client.findUnique({ where: { id: body.id } })
    if (byId) return byId
  }

  const email = normalizeEmail(body.email)
  if (email) {
    const byEmail = await prisma.client.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
    if (byEmail) return byEmail
  }

  const phone = normalizePhone(body.phone || body.mobile)
  if (phone.length >= 9) {
    const last9 = phone.slice(-9)
    const byPhone = await prisma.client.findFirst({
      where: {
        OR: [
          { phone: { contains: last9 } },
          { phoneAlt: { contains: last9 } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (byPhone) return byPhone
  }

  const name = normalizeName(body.name)
  if (!name) return null
  const type = body.type === 'individual' ? 'individual' : 'company'
  return prisma.client.findFirst({
    where: {
      clientType: type,
      name: { equals: name, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'asc' },
  })
}

async function createContactClient(prisma: PrismaClientLike, contact: Contact): Promise<any> {
  let data = contactToClientData(contact, true)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.client.create({ data })
    } catch (error: any) {
      if (error?.code !== 'P2002' || attempt === 4) throw error
      data = { ...data, clientNumber: clientNumber() }
    }
  }
  throw new Error('Failed to create a unique client number')
}

export async function listContactClients(prisma: PrismaClientLike, searchParams?: URLSearchParams): Promise<{
  contacts: Contact[]
  total: number
  page: number
  limit: number
  paginated: boolean
}> {
  await seedLegacyContactsIfEmpty(prisma)

  const q = searchParams?.get('q')?.trim()
  const type = searchParams?.get('type')?.trim()
  const page = Math.max(1, Number(searchParams?.get('page') ?? 1) || 1)
  const limit = Math.min(100, Math.max(1, Number(searchParams?.get('limit') ?? 50) || 50))
  const paginated = Boolean(q || type || searchParams?.has('page') || searchParams?.has('limit'))
  const where: Record<string, unknown> = {}

  if (type === 'customer') where.isCustomer = true
  if (type === 'vendor') where.isVendor = true
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { phoneAlt: { contains: q } },
      { kraPin: { contains: q, mode: 'insensitive' } },
    ]
  }

  const all = await prisma.client.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
    ...(paginated ? { skip: (page - 1) * limit, take: limit } : {}),
  })

  return {
    contacts: all.map(clientToContact),
    total: paginated ? await prisma.client.count({ where }) : all.length,
    page,
    limit,
    paginated,
  }
}

/**
 * Advisory-lock key for the identity signal `findExistingContact` would use
 * to match `body` — same precedence (email > phone > name). Two concurrent
 * upserts for the SAME signal (double-submit, a retried request) serialize
 * on this key instead of racing: find-then-create is a classic TOCTOU gap —
 * without a lock, both requests can see "no existing contact" and each
 * create their own Client row for what should be one contact.
 */
function contactIdentityLockKey(body: ContactInput): string | null {
  if (isUuid(body.id)) return `contact:id:${body.id}`
  const email = normalizeEmail(body.email)
  if (email) return `contact:email:${email}`
  const phone = normalizePhone(body.phone || body.mobile)
  if (phone.length >= 9) return `contact:phone:${phone.slice(-9)}`
  const name = normalizeName(body.name)
  if (name) return `contact:name:${body.type === 'individual' ? 'individual' : 'company'}:${name}`
  return null
}

async function upsertContactCritical(
  prisma: PrismaClientLike,
  body: ContactInput,
): Promise<{ contact: Contact; created: boolean } | string> {
  const existingClient = await findExistingContact(prisma, body)
  const existing = existingClient ? clientToContact(existingClient) : undefined
  const normalized = normalizeContact(body, existing)
  if (typeof normalized === 'string') return normalized

  const client = existingClient
    ? await prisma.client.update({ where: { id: existingClient.id }, data: contactToClientData(normalized) })
    : await createContactClient(prisma, normalized)

  return { contact: clientToContact(client), created: !existingClient }
}

export async function upsertContact(prisma: PrismaClientLike, body: ContactInput): Promise<{ contact: Contact; created: boolean } | string> {
  const lockKey = contactIdentityLockKey(body)
  let result: { contact: Contact; created: boolean } | string
  if (lockKey && prisma.$transaction) {
    result = await prisma.$transaction(async tx => {
      // Transaction-scoped advisory lock: blocks a second concurrent upsert
      // for the same identity from starting its own find-then-create until
      // this one commits or rolls back — released automatically either way.
      await tx.$executeRawUnsafe?.('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', lockKey)
      return upsertContactCritical(tx, body)
    })
  } else {
    // Test doubles / callers without $transaction: fail open rather than
    // block the whole feature on lock infrastructure being unavailable.
    result = await upsertContactCritical(prisma, body)
  }

  void broadcastContacts(prisma)
  return result
}

export async function updateContactById(prisma: PrismaClientLike, id: string, body: ContactInput): Promise<Contact | null | string> {
  const existingClient = await prisma.client.findUnique({ where: { id } })
  if (!existingClient) return null

  const normalized = normalizeContact(body, clientToContact(existingClient))
  if (typeof normalized === 'string') return normalized

  const client = await prisma.client.update({ where: { id }, data: contactToClientData(normalized) })
  void broadcastContacts(prisma)
  return clientToContact(client)
}

export async function deleteContactById(prisma: PrismaClientLike, id: string): Promise<boolean> {
  const existing = await prisma.client.findUnique({ where: { id } })
  if (!existing) return false
  // P1-DEED-006: never hard-delete business contacts — soft-archive via isActive=false.
  await prisma.client.update({ where: { id }, data: { isActive: false } })
  void broadcastContacts(prisma)
  return true
}

export async function broadcastContacts(prisma: PrismaClientLike): Promise<void> {
  try {
    const clients = await prisma.client.findMany({ orderBy: [{ createdAt: 'desc' }, { name: 'asc' }] })
    await saveStoreKeys({ [CONTACT_STORE_KEY]: JSON.stringify(clients.map(clientToContact)) })
  } catch (error) {
    console.error('[contacts] Failed to broadcast Prisma contacts:', error)
  }
}

async function seedLegacyContactsIfEmpty(prisma: PrismaClientLike): Promise<void> {
  const count = await prisma.client.count()
  if (count > 0) return

  const state = await loadAppState([CONTACT_STORE_KEY])
  const legacyContacts = state[CONTACT_STORE_KEY]
  if (!Array.isArray(legacyContacts) || legacyContacts.length === 0) return

  for (const item of legacyContacts) {
    if (!item || typeof item !== 'object') continue
    const normalized = normalizeContact(item as ContactInput)
    if (typeof normalized === 'string') continue
    const existing = await findExistingContact(prisma, normalized)
    if (existing) continue
    await createContactClient(prisma, normalized)
  }

  await broadcastContacts(prisma)
}
