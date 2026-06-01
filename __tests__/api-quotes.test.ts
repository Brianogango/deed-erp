import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockRequireRole, mockPrismaQuote, mockResolveClientId } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockPrismaQuote: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  mockResolveClientId: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({ default: { quote: mockPrismaQuote } }))

vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) => {
    if (typeof v !== 'string') return undefined
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined
  },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/quotes/route'
import { GET as GET_ONE, PUT, DELETE } from '@/app/api/quotes/[id]/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const CLIENT_ID  = '11111111-1111-1111-1111-111111111111'
const QUOTE_ID   = '22222222-2222-2222-2222-222222222222'
const USER_ID    = '33333333-3333-3333-3333-333333333333'

const directorSession = { user: { id: USER_ID, name: 'Director', username: 'director', role: 'director' } }
const techSession     = { user: { id: USER_ID, name: 'Tech', username: 'tech', role: 'technician' } }
const directorUser    = directorSession.user

const baseQuote = {
  id: QUOTE_ID,
  quoteNumber: 'QTE-00001',
  clientId: CLIENT_ID,
  status: 'draft',
  subtotal: 1000,
  taxAmount: 160,
  totalAmount: 1160,
  items: [],
  client: { id: CLIENT_ID, name: 'ACME Corp' },
  opportunity: null,
  createdAt: new Date().toISOString(),
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/quotes', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function idReq(id: string, body: unknown, method = 'PUT'): NextRequest {
  return new NextRequest(`http://localhost/api/quotes/${id}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }
function err403() { return Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }) }

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(directorSession)
  mockRequireRole.mockResolvedValue(directorUser)
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
  mockPrismaQuote.count.mockResolvedValue(0)
})

// ── GET /api/quotes ───────────────────────────────────────────────────────────
describe('GET /api/quotes', () => {
  it('returns 200 with all quotes', async () => {
    mockPrismaQuote.findMany.mockResolvedValue([baseQuote])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(QUOTE_ID)
  })

  it('returns empty array when no quotes exist', async () => {
    mockPrismaQuote.findMany.mockResolvedValue([])
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

// ── POST /api/quotes ──────────────────────────────────────────────────────────
describe('POST /api/quotes', () => {
  it('creates a quote and returns 201', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    const res = await POST(postReq({ clientId: CLIENT_ID, subject: 'Test' }))
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe(QUOTE_ID)
  })

  it('auto-generates quoteNumber from count when none provided', async () => {
    mockPrismaQuote.count.mockResolvedValue(4)
    mockPrismaQuote.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...baseQuote, quoteNumber: data.quoteNumber })
    )
    await POST(postReq({ clientId: CLIENT_ID }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quoteNumber: 'QTE-00005' }),
      })
    )
  })

  it('uses provided quoteNumber when given', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, quoteNumber: 'CUSTOM-001' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quoteNumber: 'CUSTOM-001' }),
      })
    )
  })

  it('maps status alias "sent" → "pending_approval"', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, status: 'sent' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending_approval' }) })
    )
  })

  it('maps status alias "accepted" → "approved"', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, status: 'accepted' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) })
    )
  })

  it('maps status alias "expired" → "cancelled"', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, status: 'expired' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) })
    )
  })

  it('maps status alias "revised" → "draft"', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, status: 'revised' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'draft' }) })
    )
  })

  it('defaults unknown status to "draft"', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, status: 'notreal' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'draft' }) })
    )
  })

  it('passes client-supplied UUID id to Prisma', async () => {
    const customId = '44444444-4444-4444-4444-444444444444'
    mockPrismaQuote.create.mockResolvedValue({ ...baseQuote, id: customId })
    await POST(postReq({ id: customId, clientId: CLIENT_ID }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: customId }) })
    )
  })

  it('ignores non-UUID id (does not pass to Prisma)', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ id: 'short-id', clientId: CLIENT_ID }))
    const callData = mockPrismaQuote.create.mock.calls[0][0].data
    expect(callData.id).toBeUndefined()
  })

  it('uses createdById from session, not from body', async () => {
    mockPrismaQuote.create.mockResolvedValue(baseQuote)
    await POST(postReq({ clientId: CLIENT_ID, createdById: 'attacker-id' }))
    expect(mockPrismaQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: USER_ID }) })
    )
  })

  it('returns 403 for technician role', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ clientId: CLIENT_ID }))
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await POST(postReq({}))
    expect(res.status).toBe(401)
  })
})

// ── GET /api/quotes/:id ───────────────────────────────────────────────────────
describe('GET /api/quotes/:id', () => {
  it('returns 200 with the quote', async () => {
    mockPrismaQuote.findUnique.mockResolvedValue(baseQuote)
    const req = new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}`)
    const res = await GET_ONE(req, { params: { id: QUOTE_ID } })
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(QUOTE_ID)
  })

  it('returns 404 when quote not found', async () => {
    mockPrismaQuote.findUnique.mockResolvedValue(null)
    const req = new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}`)
    const res = await GET_ONE(req, { params: { id: QUOTE_ID } })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const req = new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}`)
    const res = await GET_ONE(req, { params: { id: QUOTE_ID } })
    expect(res.status).toBe(401)
  })
})

// ── PUT /api/quotes/:id ───────────────────────────────────────────────────────
describe('PUT /api/quotes/:id', () => {
  it('updates a quote and returns 200', async () => {
    mockPrismaQuote.update.mockResolvedValue({ ...baseQuote, status: 'pending_approval' })
    const res = await PUT(idReq(QUOTE_ID, { status: 'sent' }), { params: { id: QUOTE_ID } })
    expect(res.status).toBe(200)
  })

  it('maps status alias on update (sent → pending_approval)', async () => {
    mockPrismaQuote.update.mockResolvedValue(baseQuote)
    await PUT(idReq(QUOTE_ID, { status: 'sent' }), { params: { id: QUOTE_ID } })
    const updateData = mockPrismaQuote.update.mock.calls[0][0].data
    expect(updateData.status).toBe('pending_approval')
  })

  it('replaces items when lines are provided', async () => {
    mockPrismaQuote.update.mockResolvedValue(baseQuote)
    const lines = [{ description: 'Laptop', qty: 1, unitPrice: 50000 }]
    await PUT(idReq(QUOTE_ID, { lines }), { params: { id: QUOTE_ID } })
    const updateData = mockPrismaQuote.update.mock.calls[0][0].data
    expect(updateData.items).toHaveProperty('deleteMany')
    expect(updateData.items).toHaveProperty('create')
  })

  it('does not touch items when lines are not provided', async () => {
    mockPrismaQuote.update.mockResolvedValue(baseQuote)
    await PUT(idReq(QUOTE_ID, { subject: 'Updated' }), { params: { id: QUOTE_ID } })
    const updateData = mockPrismaQuote.update.mock.calls[0][0].data
    expect(updateData.items).toBeUndefined()
  })

  it('returns 403 for technician role', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await PUT(idReq(QUOTE_ID, {}), { params: { id: QUOTE_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await PUT(idReq(QUOTE_ID, {}), { params: { id: QUOTE_ID } })
    expect(res.status).toBe(401)
  })
})

// ── DELETE /api/quotes/:id ────────────────────────────────────────────────────
describe('DELETE /api/quotes/:id', () => {
  it('deletes the quote and returns { ok: true }', async () => {
    mockPrismaQuote.delete.mockResolvedValue(baseQuote)
    const req = new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}`, { method: 'DELETE' })
    const res = await DELETE(req, { params: { id: QUOTE_ID } })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('returns 403 for technician role', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const req = new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}`, { method: 'DELETE' })
    const res = await DELETE(req, { params: { id: QUOTE_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const req = new NextRequest(`http://localhost/api/quotes/${QUOTE_ID}`, { method: 'DELETE' })
    const res = await DELETE(req, { params: { id: QUOTE_ID } })
    expect(res.status).toBe(401)
  })
})
