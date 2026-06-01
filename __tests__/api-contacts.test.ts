import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockRequireRole, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
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

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/contacts/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const USER_ID      = '00000000-0000-4000-8000-000000000001'
const CONTACT_ID   = '00000000-0000-4000-8000-000000000002'

const directorUser = { id: USER_ID, name: 'Director', username: 'director', role: 'director' }
const directorSession = { user: directorUser }
const techSession     = { user: { id: USER_ID, name: 'Tech', username: 'tech', role: 'technician' } }

const existingContact = {
  id: CONTACT_ID,
  name: 'ACME Corp',
  type: 'company',
  email: 'acme@example.com',
  phone: '+254700000001',
  address: '123 Main St',
  country: 'Kenya',
  isCustomer: true,
  isVendor: false,
  tags: [],
  creditLimit: 0,
  paymentTermsDays: 30,
  loyaltyPoints: 0,
  createdAt: '2026-01-01',
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }
function err403() { return Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(directorSession)
  mockRequireRole.mockResolvedValue(directorUser)
  mockLoadAppState.mockResolvedValue({ deed_contacts: [existingContact] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

// ── GET /api/contacts ─────────────────────────────────────────────────────────
describe('GET /api/contacts', () => {
  it('returns 200 with the contacts array', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('ACME Corp')
  })

  it('returns empty array when no contacts in store', async () => {
    mockLoadAppState.mockResolvedValue({})
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns empty array when store has non-array value', async () => {
    mockLoadAppState.mockResolvedValue({ deed_contacts: 'bad-data' })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

// ── POST /api/contacts ────────────────────────────────────────────────────────
describe('POST /api/contacts', () => {
  it('creates a contact and returns 201', async () => {
    const res = await POST(postReq({ name: 'New Customer', type: 'individual' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('New Customer')
  })

  it('generates a UUID id for the new contact', async () => {
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

  it('defaults paymentTermsDays to 30', async () => {
    const res = await POST(postReq({ name: 'Customer' }))
    expect((await res.json()).paymentTermsDays).toBe(30)
  })

  it('defaults type to "company" for unrecognized type values', async () => {
    const res = await POST(postReq({ name: 'Org', type: 'nonprofit' }))
    expect((await res.json()).type).toBe('company')
  })

  it('preserves type "individual" when provided', async () => {
    const res = await POST(postReq({ name: 'Person', type: 'individual' }))
    expect((await res.json()).type).toBe('individual')
  })

  it('prepends new contact to existing list (unshift)', async () => {
    let savedContacts: any[] | null = null
    mockSaveStoreKeys.mockImplementation((data: any) => {
      savedContacts = JSON.parse(data['deed_contacts'])
      return Promise.resolve()
    })
    await POST(postReq({ name: 'New First' }))
    expect(savedContacts![0].name).toBe('New First')
    expect(savedContacts![1].name).toBe('ACME Corp')
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
