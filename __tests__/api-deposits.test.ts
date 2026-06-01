import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockLoadAppState, mockSaveStoreKeys, mockGetNextDepositRef } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetNextDepositRef: vi.fn(),
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
  requireRole: vi.fn(),
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

vi.mock('@/lib/deposit-ref-counter', () => ({
  getNextDepositRef: mockGetNextDepositRef,
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/deposits/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const USER_ID     = '00000000-1111-4000-8000-000000000001'
const CUSTOMER_ID = '00000000-1111-4000-8000-000000000002'

const session = { user: { id: USER_ID, name: 'Finance Officer', username: 'finance', role: 'finance_officer' } }

const sampleDeposit = {
  id: '00000000-1111-4000-8000-000000000003',
  ref: 'DEP/0001',
  customerId: CUSTOMER_ID,
  customerName: 'John Doe',
  customerPhone: '+254712345678',
  items: [{ productId: 'prod1', productName: 'Laptop', sku: 'LAP-001', qty: 1, unitPrice: 80000, total: 80000 }],
  totalValue: 80000,
  totalPaid: 20000,
  balance: 60000,
  status: 'partially_paid',
  payments: [],
  createdAt: new Date().toISOString(),
  createdBy: 'Finance Officer',
}

const minValidBody = {
  customerId: CUSTOMER_ID,
  customerName: 'John Doe',
  customerPhone: '+254712345678',
  items: [{ productId: 'prod1', productName: 'Laptop', sku: 'LAP-001', qty: 1, unitPrice: 80000, total: 80000 }],
  totalValue: 80000,
  initialPayment: 20000,
  payMethod: 'mpesa',
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/deposits', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(session)
  mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [sampleDeposit] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockGetNextDepositRef.mockResolvedValue('DEP/0002')
})

// ── GET /api/deposits ─────────────────────────────────────────────────────────
describe('GET /api/deposits', () => {
  it('returns 200 with all deposits', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].ref).toBe('DEP/0001')
  })

  it('returns empty array when no deposits in store', async () => {
    mockLoadAppState.mockResolvedValue({})
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns empty array when store value is not an array', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deposits_v1: 'bad' })
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

// ── POST /api/deposits ────────────────────────────────────────────────────────
describe('POST /api/deposits', () => {
  it('creates a deposit and returns 201', async () => {
    const res = await POST(postReq(minValidBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ref).toBe('DEP/0002')
    expect(body.customerId).toBe(CUSTOMER_ID)
    expect(body.customerName).toBe('John Doe')
  })

  it('status is "fully_paid" when deposit equals totalValue', async () => {
    const res = await POST(postReq({ ...minValidBody, initialPayment: 80000 }))
    expect(res.status).toBe(201)
    expect((await res.json()).status).toBe('fully_paid')
  })

  it('status is "fully_paid" when deposit exceeds totalValue', async () => {
    const res = await POST(postReq({ ...minValidBody, initialPayment: 90000 }))
    expect(res.status).toBe(201)
    expect((await res.json()).status).toBe('fully_paid')
  })

  it('status is "partially_paid" when deposit < totalValue', async () => {
    const res = await POST(postReq({ ...minValidBody, initialPayment: 20000 }))
    expect(res.status).toBe(201)
    expect((await res.json()).status).toBe('partially_paid')
  })

  it('calculates balance correctly', async () => {
    const res = await POST(postReq({ ...minValidBody, totalValue: 80000, initialPayment: 20000 }))
    const body = await res.json()
    expect(body.balance).toBe(60000)
    expect(body.totalPaid).toBe(20000)
  })

  it('creates initial payment entry in payments array', async () => {
    const res = await POST(postReq(minValidBody))
    const body = await res.json()
    expect(body.payments).toHaveLength(1)
    expect(body.payments[0].amount).toBe(20000)
    expect(body.payments[0].method).toBe('mpesa')
    expect(body.payments[0].recordedBy).toBe('Finance Officer')
  })

  it('payment id is a valid UUID', async () => {
    const res = await POST(postReq(minValidBody))
    const body = await res.json()
    expect(body.payments[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('deposit id is a valid UUID', async () => {
    const res = await POST(postReq(minValidBody))
    const body = await res.json()
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('prepends new deposit to existing list', async () => {
    let saved: any[] | null = null
    mockSaveStoreKeys.mockImplementation((data: any) => {
      saved = JSON.parse(data['deed_deposits_v1'])
      return Promise.resolve()
    })
    await POST(postReq(minValidBody))
    expect(saved![0].ref).toBe('DEP/0002')
    expect(saved![1].ref).toBe('DEP/0001')
  })

  it('returns 422 when customerId is missing', async () => {
    const { customerId: _1, ...body } = minValidBody
    const res = await POST(postReq(body))
    expect(res.status).toBe(422)
  })

  it('returns 422 when customerName is missing', async () => {
    const { customerName: _1, ...body } = minValidBody
    const res = await POST(postReq(body))
    expect(res.status).toBe(422)
  })

  it('returns 422 when items array is empty', async () => {
    const res = await POST(postReq({ ...minValidBody, items: [] }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when initialPayment is zero', async () => {
    const res = await POST(postReq({ ...minValidBody, initialPayment: 0 }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when initialPayment is negative', async () => {
    const res = await POST(postReq({ ...minValidBody, initialPayment: -100 }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when initialPayment is not provided', async () => {
    const { initialPayment: _1, ...body } = minValidBody
    const res = await POST(postReq(body))
    expect(res.status).toBe(422)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await POST(postReq(minValidBody))
    expect(res.status).toBe(401)
  })
})
