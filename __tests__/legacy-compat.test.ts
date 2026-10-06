import { describe, it, expect, vi } from 'vitest'

// legacy-compat imports sql at module load time — stub it out
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn() }))

import { isUuid, optionalUuid } from '@/lib/legacy-compat'

describe('isUuid() — strict RFC validator (checks version and variant bits)', () => {
  it('accepts a valid UUID v4', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts a valid UUID v1', () => {
    expect(isUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
  })

  it('rejects all-zero UUID (version 0 fails [1-5] check)', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(false)
  })

  it('rejects 7-char base-36 legacy ID', () => {
    expect(isUuid('a7f2k4m')).toBe(false)
  })

  it('rejects null', () => {
    expect(isUuid(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isUuid(undefined)).toBe(false)
  })

  it('rejects number', () => {
    expect(isUuid(42)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isUuid('')).toBe(false)
  })

  it('rejects truncated UUID', () => {
    expect(isUuid('550e8400-e29b-41d4')).toBe(false)
  })

  it('rejects UUID without dashes', () => {
    expect(isUuid('550e8400e29b41d4a716446655440000')).toBe(false)
  })
})

describe('optionalUuid()', () => {
  it('returns the UUID string unchanged when valid', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(optionalUuid(uuid)).toBe(uuid)
  })

  it('returns undefined for a non-UUID string', () => {
    expect(optionalUuid('short-id')).toBeUndefined()
    expect(optionalUuid('a7f2k4m')).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(optionalUuid(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(optionalUuid(undefined)).toBeUndefined()
  })

  it('returns undefined for a number', () => {
    expect(optionalUuid(42)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(optionalUuid('')).toBeUndefined()
  })

  it('returns undefined for all-zero UUID (fails strict version check)', () => {
    expect(optionalUuid('00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })
})

// ── resolveClientId: whose document is it ─────────────────────────────────
const contactsState = vi.hoisted(() => ({ contacts: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn(async () => ({ deed_contacts: contactsState.contacts })) }))

import { resolveClientId } from '@/lib/legacy-compat'

const JOHN = { id: '11111111-1111-4111-8111-111111111111', name: 'John Malcolm Odhiambo', email: 'deedtechnical@gmail.com', phone: null }
const DERRICK_ID = 'db04b7b1-6516-46db-ab57-4c9ccc4272d3'

function prismaWith(clients: Array<Record<string, any>>) {
  const matches = (c: Record<string, any>, where: any): boolean => {
    if (!where) return true
    if (where.OR) return where.OR.some((w: any) => matches(c, w)) && matches(c, { ...where, OR: undefined })
    return Object.entries(where).every(([k, cond]: [string, any]) => {
      if (k === 'OR' || cond === undefined) return true
      if (cond && typeof cond === 'object' && 'equals' in cond) return String(c[k] ?? '').toLowerCase() === String(cond.equals).toLowerCase()
      if (cond && typeof cond === 'object' && 'contains' in cond) return String(c[k] ?? '').includes(cond.contains)
      return c[k] === cond
    })
  }
  return {
    client: {
      findUnique: vi.fn(async ({ where }: any) => clients.find(c => c.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => clients.find(c => matches(c, where)) ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: data.id ?? 'new-id', ...data }; clients.push(row); return row }),
    },
  }
}

describe('resolveClientId()', () => {
  it('files a sale under the contact it names, not whoever shares the shop email', async () => {
    contactsState.contacts = [{ id: DERRICK_ID, name: 'Derrick Mwenda', email: 'deedtechnical@gmail.com' }]
    const prisma = prismaWith([{ ...JOHN }])
    const id = await resolveClientId(prisma as any, DERRICK_ID, { partnerName: 'Derrick Mwenda' })
    expect(id).toBe(DERRICK_ID)
    expect(prisma.client.create.mock.calls[0][0].data).toMatchObject({ id: DERRICK_ID, name: 'Derrick Mwenda' })
  })

  it('reuses a contact by email or phone only when the name matches too', async () => {
    contactsState.contacts = []
    const prisma = prismaWith([{ ...JOHN }])
    const other = await resolveClientId(prisma as any, undefined, { partnerName: 'Mary Wanjiku', email: 'deedtechnical@gmail.com' })
    expect(other).not.toBe(JOHN.id)
    const same = await resolveClientId(prisma as any, undefined, { partnerName: 'john malcolm odhiambo', email: 'deedtechnical@gmail.com' })
    expect(same).toBe(JOHN.id)
  })

  it('returns an existing contact by id directly', async () => {
    const prisma = prismaWith([{ ...JOHN }])
    expect(await resolveClientId(prisma as any, JOHN.id, { partnerName: 'Someone else' })).toBe(JOHN.id)
  })
})
