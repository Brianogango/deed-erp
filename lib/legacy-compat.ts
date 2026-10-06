
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PrismaLike = {
  client: {
    findUnique: (args: any) => Promise<any>
    findFirst: (args: any) => Promise<any>
    create: (args: any) => Promise<any>
  }
}

type LegacyContact = Record<string, any>

type ClientResolutionContext = {
  name?: unknown
  clientName?: unknown
  customerName?: unknown
  partnerName?: unknown
  companyName?: unknown
  email?: unknown
  clientEmail?: unknown
  customerEmail?: unknown
  partnerEmail?: unknown
  phone?: unknown
  clientPhone?: unknown
  customerPhone?: unknown
  partnerPhone?: unknown
  address?: unknown
  clientType?: unknown
  type?: unknown
  isVendor?: unknown
  isCustomer?: unknown
  notes?: unknown
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function optionalUuid(value: unknown): string | undefined {
  return isUuid(value) ? value : undefined
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asText(value)
    if (text) return text
  }
  return null
}

function truncate(value: string | null, max: number): string | null {
  return value ? value.slice(0, max) : null
}

async function loadLegacyContacts(): Promise<LegacyContact[]> {
  try {
    // The live store (Prisma-backed in production), not the retired app_state
    // table, which only holds an old copy of the contacts.
    const { loadAppState } = await import('@/lib/server-store')
    const state = await loadAppState(['deed_contacts'])
    const parsed = state.deed_contacts
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') as LegacyContact[] : []
  } catch (error) {
    console.error('[legacy-compat] Failed to load legacy contacts:', error)
    return []
  }
}

async function findLegacyContact(rawId: string | null, context: ClientResolutionContext): Promise<LegacyContact | null> {
  const contacts = await loadLegacyContacts()
  if (rawId) {
    const exact = contacts.find((contact) => String(contact.id ?? '') === rawId)
    if (exact) return exact
  }

  const email = firstText(context.email, context.clientEmail, context.customerEmail, context.partnerEmail)
  const phone = firstText(context.phone, context.clientPhone, context.customerPhone, context.partnerPhone)
  const name = firstText(context.name, context.clientName, context.customerName, context.partnerName, context.companyName)

  // An email or phone alone does not identify a person: the shop's own email
  // or a family number is often typed for several customers. With a name to
  // go by, only a contact of that name counts.
  const sameName = (contact: LegacyContact) =>
    !name || String(contact.name ?? '').trim().toLowerCase() === name.trim().toLowerCase()
  if (email) {
    const byEmail = contacts.find((contact) => String(contact.email ?? '').trim().toLowerCase() === email.toLowerCase() && sameName(contact))
    if (byEmail) return byEmail
  }
  if (phone) {
    const byPhone = contacts.find((contact) => String(contact.phone ?? '').trim() === phone && sameName(contact))
    if (byPhone) return byPhone
  }
  if (name) {
    const byName = contacts.find((contact) => String(contact.name ?? '').trim().toLowerCase() === name.toLowerCase())
    if (byName) return byName
  }

  return null
}

function mapClientInput(rawId: string | null, legacy: LegacyContact | null, context: ClientResolutionContext) {
  const name = firstText(
    context.name,
    context.clientName,
    context.customerName,
    context.partnerName,
    context.companyName,
    legacy?.name,
    legacy?.companyName,
    rawId && !isUuid(rawId) ? `Legacy Customer ${rawId}` : null,
    'Walk-in Customer',
  )!

  const email = firstText(context.email, context.clientEmail, context.customerEmail, context.partnerEmail, legacy?.email)
  const phone = firstText(context.phone, context.clientPhone, context.customerPhone, context.partnerPhone, legacy?.phone, legacy?.mobile)
  const address = firstText(context.address, legacy?.address, legacy?.physicalAddress, legacy?.postalAddress)
  const companyName = firstText(context.companyName, legacy?.companyName, legacy?.type === 'company' ? legacy?.name : null)
  const legacyType = firstText(context.clientType, context.type, legacy?.type)
  const clientType = legacyType === 'company' ? 'company' : 'individual'
  const noteParts = [
    firstText(context.notes, legacy?.notes),
    rawId && !isUuid(rawId) ? `Legacy contact ID: ${rawId}` : null,
  ].filter(Boolean)

  return {
    clientType,
    name: truncate(name, 200)!,
    email: truncate(email, 150),
    phone: truncate(phone, 20),
    phoneAlt: truncate(firstText(legacy?.phoneAlt, legacy?.mobileAlt), 20),
    companyName: truncate(companyName, 200),
    kraPin: truncate(firstText(legacy?.kraPin, legacy?.taxId, legacy?.vatNumber), 20),
    idNumber: truncate(firstText(legacy?.idNumber), 20),
    addressLine1: address,
    addressLine2: firstText(legacy?.addressLine2, legacy?.postalAddress),
    city: truncate(firstText(legacy?.city), 100),
    country: truncate(firstText(legacy?.country, 'Kenya'), 100),
    industry: truncate(firstText(legacy?.industry), 100),
    segment: truncate(firstText(legacy?.segment), 100),
    employees: legacy?.employees != null && !Number.isNaN(Number(legacy.employees)) ? Number(legacy.employees) : null,
    tags: Array.isArray(legacy?.tags) ? legacy.tags : [],
    creditLimit: legacy?.creditLimit != null && !Number.isNaN(Number(legacy.creditLimit)) ? Number(legacy.creditLimit) : 0,
    isActive: legacy?.status !== 'inactive',
    notes: noteParts.join('\n') || null,
  }
}

async function createClientWithUniqueNumber(prisma: PrismaLike, data: Record<string, any>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`.slice(-8)
    try {
      return await prisma.client.create({
        data: {
          clientNumber: `CLT-${suffix}`,
          ...data,
        },
      })
    } catch (error: any) {
      if (error?.code !== 'P2002' || attempt === 4) throw error
    }
  }
  throw new Error('Failed to create a unique client number')
}

export async function resolveClientId(
  prisma: PrismaLike,
  rawClientId: unknown,
  context: ClientResolutionContext = {},
): Promise<string> {
  const rawId = asText(rawClientId)

  if (rawId && isUuid(rawId)) {
    const existing = await prisma.client.findUnique({ where: { id: rawId } })
    if (existing) return existing.id
  }

  const legacy = await findLegacyContact(rawId, context)
  const mapped = mapClientInput(rawId, legacy, context)
  const email = mapped.email
  const phone = mapped.phone
  const name = mapped.name

  // The document names a contact this browser knows by id (lib/store's
  // contacts) that the server does not hold yet: that is the person. Create
  // them under the same id. Matching by email/phone instead filed sales under
  // whoever else carried the same email (e.g. the shop's own address).
  if (rawId && isUuid(rawId) && legacy && String(legacy.id ?? '') === rawId) {
    try {
      const created = await createClientWithUniqueNumber(prisma, { ...mapped, id: rawId })
      return created.id
    } catch (error) {
      const raced = await prisma.client.findUnique({ where: { id: rawId } })
      if (raced) return raced.id
      throw error
    }
  }

  const exactLegacyNote = rawId && !isUuid(rawId) ? `Legacy contact ID: ${rawId}` : null
  if (exactLegacyNote) {
    const byNote = await prisma.client.findFirst({ where: { notes: { contains: exactLegacyNote, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } })
    if (byNote) return byNote.id
  }

  // Reuse an existing contact only when the name matches; prefer the one that
  // also has this email or phone. Two people can share an email or a number.
  if (name) {
    const sameName = { name: { equals: name, mode: 'insensitive' } }
    const contactMatch: any[] = []
    if (email) contactMatch.push({ email: { equals: email, mode: 'insensitive' } })
    if (phone) contactMatch.push({ phone })
    const existing = (contactMatch.length
      ? await prisma.client.findFirst({ where: { ...sameName, OR: contactMatch }, orderBy: { createdAt: 'asc' } })
      : null)
      ?? await prisma.client.findFirst({ where: sameName, orderBy: { createdAt: 'asc' } })
    if (existing) return existing.id
  }

  const created = await createClientWithUniqueNumber(prisma, mapped)
  return created.id
}
