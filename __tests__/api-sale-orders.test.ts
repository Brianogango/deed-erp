import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockPrismaSO, mockResolveClientId, mockGetNextDocNumber } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaSO: {
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  mockResolveClientId: vi.fn(),
  mockGetNextDocNumber: vi.fn(),
}))

vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))

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
  requireRole: vi.fn(),
  jsonError: (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

vi.mock('@/lib/prisma', () => ({ default: { saleOrder: mockPrismaSO } }))

vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) => {
    if (typeof v !== 'string') return undefined
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined
  },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/sale-orders/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const CLIENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const ORDER_ID  = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const USER_ID   = '11111111-2222-3333-4444-555555555555'

const session = { user: { id: USER_ID, name: 'Director', username: 'director', role: 'director' } }

const dbOrder = {
  id: ORDER_ID,
  orderNumber: 'SO-00001',
  clientId: CLIENT_ID,
  status: 'pending',
  orderDate: new Date('2026-06-01'),
  totalAmount: 10000,
  taxAmount: 1600,
  subtotal: 8400,
  discountAmount: 0,
  amountPaid: 0,
  createdAt: new Date().toISOString(),
  client: { id: CLIENT_ID, name: 'Acme Ltd' },
  items: [
    { id: 'item-1', productId: null, description: 'Laptop', qty: 1, unitPrice: 8400, taxRate: 16, lineTotal: 10000 },
  ],
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/sale-orders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getReq(query = ''): Request {
  return new Request(`http://localhost/api/sale-orders${query}`)
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(session)
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
  mockPrismaSO.count.mockResolvedValue(0)
  mockGetNextDocNumber.mockResolvedValue('SO-00001')
})

// ── GET /api/sale-orders ──────────────────────────────────────────────────────
describe('GET /api/sale-orders', () => {
  it('returns 200 with paginated transformed orders', async () => {
    mockPrismaSO.findMany.mockResolvedValue([dbOrder])
    mockPrismaSO.count.mockResolvedValue(1)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(ORDER_ID)
    expect(body.total).toBe(1)
    expect(body.limit).toBe(50)
  })

  it('transforms response: adds ref, customerId, customerName, date, total, lines', async () => {
    mockPrismaSO.findMany.mockResolvedValue([dbOrder])
    mockPrismaSO.count.mockResolvedValue(1)
    const res = await GET(getReq())
    const { items } = await res.json()
    const [order] = items
    expect(order.ref).toBe('SO-00001')
    expect(order.customerId).toBe(CLIENT_ID)
    expect(order.customerName).toBe('Acme Ltd')
    expect(order.total).toBe(10000)
    expect(order.taxTotal).toBe(1600)
    expect(Array.isArray(order.lines)).toBe(true)
    expect(order.lines[0].productName).toBe('Laptop')
  })

  it('formats date as YYYY-MM-DD string', async () => {
    mockPrismaSO.findMany.mockResolvedValue([dbOrder])
    mockPrismaSO.count.mockResolvedValue(1)
    const res = await GET(getReq())
    const { items: [order] } = await res.json()
    expect(order.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns empty items when no orders', async () => {
    mockPrismaSO.findMany.mockResolvedValue([])
    mockPrismaSO.count.mockResolvedValue(0)
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 0, totalPages: 0 })
  })

  it('filters by status query param', async () => {
    mockPrismaSO.findMany.mockResolvedValue([])
    mockPrismaSO.count.mockResolvedValue(0)
    await GET(getReq('?status=pending'))
    expect(mockPrismaSO.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'pending' }) })
    )
  })

  it('filters by search query param q', async () => {
    mockPrismaSO.findMany.mockResolvedValue([])
    mockPrismaSO.count.mockResolvedValue(0)
    await GET(getReq('?q=ACME'))
    const callArg = mockPrismaSO.findMany.mock.calls[0][0]
    expect(callArg.where.OR).toBeDefined()
  })

  it('caps limit at 200', async () => {
    mockPrismaSO.findMany.mockResolvedValue([])
    mockPrismaSO.count.mockResolvedValue(0)
    const res = await GET(getReq('?limit=999'))
    const body = await res.json()
    expect(body.limit).toBe(200)
    expect(mockPrismaSO.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })
})

// ── POST /api/sale-orders ─────────────────────────────────────────────────────
describe('POST /api/sale-orders', () => {
  it('creates a sale order and returns 201', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    const res = await POST(postReq({ clientId: CLIENT_ID, items: [] }))
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe(ORDER_ID)
  })

  it('auto-generates orderNumber from the atomic counter', async () => {
    mockGetNextDocNumber.mockResolvedValue('SO-00004')
    mockPrismaSO.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...dbOrder, orderNumber: data.orderNumber })
    )
    await POST(postReq({ clientId: CLIENT_ID }))
    expect(mockPrismaSO.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderNumber: 'SO-00004' }) })
    )
  })

  it('uses provided orderNumber (or ref alias)', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    await POST(postReq({ clientId: CLIENT_ID, ref: 'SO-CUSTOM' }))
    expect(mockPrismaSO.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderNumber: 'SO-CUSTOM' }) })
    )
  })

  it('passes client-supplied UUID id to Prisma', async () => {
    const customId = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb'
    mockPrismaSO.create.mockResolvedValue({ ...dbOrder, id: customId })
    await POST(postReq({ id: customId, clientId: CLIENT_ID }))
    expect(mockPrismaSO.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: customId }) })
    )
  })

  it('ignores non-UUID id', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    await POST(postReq({ id: 'bad', clientId: CLIENT_ID }))
    const callData = mockPrismaSO.create.mock.calls[0][0].data
    expect(callData.id).toBeUndefined()
  })

  it('always uses session user as createdById', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    await POST(postReq({ clientId: CLIENT_ID, createdById: 'attacker' }))
    expect(mockPrismaSO.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: USER_ID }) })
    )
  })

  it('maps item fields correctly', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    const items = [{ productName: 'Laptop', qty: 2, unitPrice: 50000, taxRate: 16, lineTotal: 116000 }]
    await POST(postReq({ clientId: CLIENT_ID, items }))
    const createData = mockPrismaSO.create.mock.calls[0][0].data
    expect(createData.items.create[0].description).toBe('Laptop')
    expect(createData.items.create[0].qty).toBe(2)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await POST(postReq({}))
    expect(res.status).toBe(401)
  })
})

// ── Odoo status vocabulary at the API boundary ───────────────────────────────
describe('sale-order status normalization (Odoo vocabulary)', () => {
  it('GET normalizes legacy DB statuses onto the Odoo stages', async () => {
    mockPrismaSO.findMany.mockResolvedValue([
      { ...dbOrder, status: 'pending' },
      { ...dbOrder, id: 'a1', status: 'confirmed' },
      { ...dbOrder, id: 'a2', status: 'delivered' },
      { ...dbOrder, id: 'a3', status: 'invoiced' },
      { ...dbOrder, id: 'a4', status: 'quotation_sent' },
      { ...dbOrder, id: 'a5', status: 'cancelled' },
    ])
    mockPrismaSO.count.mockResolvedValue(6)
    const res = await GET(getReq())
    const body = await res.json()
    expect(body.items.map((o: any) => o.status)).toEqual([
      'quotation', 'sale', 'sale', 'sale', 'quotation_sent', 'cancelled',
    ])
  })

  it('POST accepts the new statuses instead of coercing them away', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    await POST(postReq({ clientId: CLIENT_ID, status: 'quotation_sent' }))
    expect(mockPrismaSO.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'quotation_sent' }) })
    )
    await POST(postReq({ clientId: CLIENT_ID, status: 'sale' }))
    expect(mockPrismaSO.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sale' }) })
    )
  })

  it('POST maps legacy client statuses to their Odoo equivalents', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    await POST(postReq({ clientId: CLIENT_ID, status: 'confirmed' }))
    expect(mockPrismaSO.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'sale' }) })
    )
    await POST(postReq({ clientId: CLIENT_ID, status: 'pending_approval' }))
    expect(mockPrismaSO.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'quotation' }) })
    )
  })

  it('POST defaults a missing status to quotation (saving never confirms)', async () => {
    mockPrismaSO.create.mockResolvedValue(dbOrder)
    await POST(postReq({ clientId: CLIENT_ID }))
    expect(mockPrismaSO.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'quotation' }) })
    )
  })
})
