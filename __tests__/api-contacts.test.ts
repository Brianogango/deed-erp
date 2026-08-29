import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetSession,
  mockRequireRole,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockPrisma,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockPrisma: {
    client: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const msg = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  getRequiredSession: mockGetSession,
  requireRole: mockRequireRole,
  jsonError: (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/contacts/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const USER_ID = '00000000-0000-4000-8000-000000000001'
const CONTACT_ID = '00000000-0000-4000-8000-000000000002'

const directorUser = { id: USER_ID, name: 'Director', username: 'director', role: 'director' }
const directorSession = { user: directorUser }

const existingClient = {
  id: CONTACT_ID,
  clientNumber: 'CLT-0000001',
  name: 'ACME Corp',
  clientType: 'company',
  companyName: null,
  registrationNumber: null,
  email: 'acme@example.com',
  phone: '+254700000001',
  phoneAlt: null,
  website: null,
  idNumber: null,
  kraPin: null,
  addressLine1: '123 Main St',
  addressLine2: null,
  city: null,
  country: 'Kenya',
  industry: null,
  tags: [],
  creditLimit: 0,
  isCustomer: true,
  isVendor: false,
  paymentTermsDays: 30,
  bankName: null,
  bankAccount: null,
  bankBranch: null,
  vendorRating: 0,
  loyaltyPoints: 0,
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeClient(data: Record<string, any>) {
  return {
    ...existingClient,
    id: data.id ?? '00000000-0000-4000-8000-000000000099',
    clientNumber: data.clientNumber ?? 'CLT-NEW',
    createdAt: data.createdAt ?? new Date('2026-01-02T00:00:00.000Z'),
    ...data,
  }
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }
function err403() { return Object.assign(new Error('Forbidden - insufficient role'), { status: 403 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(directorSession)
  mockRequireRole.mockResolvedValue(directorUser)
  mockLoadAppState.mockResolvedValue({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockPrisma.client.count.mockResolvedValue(1)
  mockPrisma.client.findMany.mockResolvedValue([existingClient])
  mockPrisma.client.findFirst.mockResolvedValue(null)
  mockPrisma.client.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id === CONTACT_ID ? existingClient : null),
  )
  mockPrisma.client.create.mockImplementation(({ data }: any) => Promise.resolve(makeClient(data)))
  mockPrisma.client.update.mockImplementation(({ data }: any) => Promise.resolve(makeClient({ ...existingClient, ...data })))
  mockPrisma.client.delete.mockResolvedValue(existingClient)
})

// ── GET /api/contacts ─────────────────────────────────────────────────────────
describe('GET /api/contacts', () => {
  it('returns 200 with the Prisma contacts array', async () => {
    const res = await GET(new Request('http://localhost/api/contacts'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('ACME Corp')
    expect(body[0].type).toBe('company')
  })

  it('returns a paginated resource shape when query params are provided', async () => {
    const res = await GET(new Request('http://localhost/api/contacts?q=acme&page=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it('returns empty array when Prisma has no contacts and no legacy contacts', async () => {
    mockPrisma.client.count.mockResolvedValue(0)
    mockPrisma.client.findMany.mockResolvedValue([])
    mockLoadAppState.mockResolvedValue({})
    const res = await GET(new Request('http://localhost/api/contacts'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('seeds legacy contacts into Prisma when the clients table is empty', async () => {
    mockPrisma.client.count.mockResolvedValue(0)
    mockPrisma.client.findMany.mockResolvedValueOnce([makeClient({ name: 'Legacy Co' })])
    mockLoadAppState.mockResolvedValue({
      deed_contacts: [{ name: 'Legacy Co', type: 'company', email: 'legacy@example.com', phone: '', address: '', tags: [] }],
    })
    const res = await GET(new Request('http://localhost/api/contacts'))
    expect(res.status).toBe(200)
    expect(mockPrisma.client.create).toHaveBeenCalled()
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET(new Request('http://localhost/api/contacts'))
    expect(res.status).toBe(401)
  })
})

// ── POST /api/contacts ────────────────────────────────────────────────────────
describe('POST /api/contacts', () => {
  it('creates a contact in Prisma and returns 201', async () => {
    const res = await POST(postReq({ name: 'New Customer', type: 'individual' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('New Customer')
    expect(mockPrisma.client.create).toHaveBeenCalled()
  })

  it.each([
    { name: 'Phone-only Customer', isCustomer: true, isVendor: false },
    { name: 'Phone-only Vendor', isCustomer: false, isVendor: true },
  ])('creates $name without requiring an email address', async contact => {
    const res = await POST(postReq({ ...contact, type: 'company', phone: '+254700000001', email: '' }))
    expect(res.status).toBe(201)
    expect(mockPrisma.client.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: null, phone: '+254700000001' }),
    }))
    expect((await res.json()).email).toBe('')
  })

  it('generates a UUID id for the new contact through Prisma', async () => {
    const res = await POST(postReq({ name: 'Test Co' }))
    const body = await res.json()
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('defaults country to "Kenya" when not provided', async () => {
    const res = await POST(postReq({ name: 'Local Co' }))
    const body = await res.json()
    expect(body.country).toBe('Kenya')
  })

  it('uses provided country when given', async () => {
    const res = await POST(postReq({ name: 'UK Corp', country: 'United Kingdom' }))
    const body = await res.json()
    expect(body.country).toBe('United Kingdom')
  })

  it('defaults isCustomer to true', async () => {
    const res = await POST(postReq({ name: 'Customer' }))
    expect((await res.json()).isCustomer).toBe(true)
  })

  it('defaults isVendor to false', async () => {
    const res = await POST(postReq({ name: 'Customer' }))
    expect((await res.json()).isVendor).toBe(false)
  })

  it('defaults paymentTermsDays to 0 (due immediately)', async () => {
    const res = await POST(postReq({ name: 'Customer' }))
    expect((await res.json()).paymentTermsDays).toBe(0)
  })

  it('defaults type to "company" for unrecognized type values', async () => {
    const res = await POST(postReq({ name: 'Org', type: 'nonprofit' }))
    expect((await res.json()).type).toBe('company')
  })

  it('preserves type "individual" when provided', async () => {
    const res = await POST(postReq({ name: 'Person', type: 'individual' }))
    expect((await res.json()).type).toBe('individual')
  })

  it('broadcasts Prisma contacts back to the legacy store key after creating', async () => {
    let savedContacts: any[] | null = null
    mockPrisma.client.findMany.mockResolvedValueOnce([makeClient({ name: 'New First' }), existingClient])
    mockSaveStoreKeys.mockImplementation((data: any) => {
      savedContacts = JSON.parse(data.deed_contacts)
      return Promise.resolve()
    })
    await POST(postReq({ name: 'New First' }))
    expect(savedContacts![0].name).toBe('New First')
    expect(savedContacts![1].name).toBe('ACME Corp')
  })

  it('updates an existing Prisma contact when a duplicate email is posted', async () => {
    mockPrisma.client.findFirst.mockResolvedValueOnce(existingClient)
    const res = await POST(postReq({ name: 'ACME Renamed', email: 'acme@example.com' }))
    expect(res.status).toBe(200)
    expect(mockPrisma.client.update).toHaveBeenCalled()
    expect((await res.json()).name).toBe('ACME Renamed')
  })

  it('returns 422 when name is missing', async () => {
    const res = await POST(postReq({ type: 'individual' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  it('returns 422 when name is empty string', async () => {
    const res = await POST(postReq({ name: '   ' }))
    expect(res.status).toBe(422)
  })

  it('returns 403 for technician role', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await POST(postReq({ name: 'Blocked' }))
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockRejectedValue(err401())
    const res = await POST(postReq({ name: 'Ghost' }))
    expect(res.status).toBe(401)
  })
})
