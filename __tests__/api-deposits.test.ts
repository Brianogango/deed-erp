/**
 * Route-level tests for GET/POST /api/deposits.
 * GET reads Prisma deposits; POST validates the payload in-route, then
 * delegates to createDepositWithReceipt (deposit-service business rules are
 * covered in deposit-service.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockRequireRole, mockPrisma, mockCreateDepositWithReceipt, mockGetNextDepositRef } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockPrisma: { deposit: { findMany: vi.fn() } },
  mockCreateDepositWithReceipt: vi.fn(),
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
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/accounting/deposit-service', () => ({
  createDepositWithReceipt: mockCreateDepositWithReceipt,
}))
vi.mock('@/lib/deposit-ref-counter', () => ({
  getNextDepositRef: mockGetNextDepositRef,
}))

import { GET, POST } from '@/app/api/deposits/route'

const USER_ID = '00000000-1111-4000-8000-000000000001'
const CUSTOMER_ID = '00000000-1111-4000-8000-000000000002'
const session = { user: { id: USER_ID, name: 'Finance Officer', username: 'finance', role: 'finance_officer' } }

const sampleRow = {
  id: '00000000-1111-4000-8000-000000000003',
  ref: 'DEP/0001',
  customerId: CUSTOMER_ID,
  customerName: 'John Doe',
  customerPhone: '+254712345678',
  items: [{ id: 'i-1', productId: 'prod1', productName: 'Laptop', sku: 'LAP-001', qty: 1, unitPrice: 80000, lineTotal: 80000 }],
  totalValue: 80000,
  totalPaid: 20000,
  balance: 60000,
  status: 'partially_paid',
  payments: [],
  notes: null,
  dueDate: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
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
  mockRequireRole.mockResolvedValue(session.user)
  mockPrisma.deposit.findMany.mockResolvedValue([sampleRow])
  mockCreateDepositWithReceipt.mockResolvedValue(sampleRow)
  mockGetNextDepositRef.mockResolvedValue('DEP/0002')
})

describe('GET /api/deposits', () => {
  it('returns deposits mapped to the client shape', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].ref).toBe('DEP/0001')
    expect(body[0].totalPaid).toBe(20000)
    expect(body[0].items[0].total).toBe(80000)
  })

  it('returns an empty array when there are no deposits', async () => {
    mockPrisma.deposit.findMany.mockResolvedValue([])
    const res = await GET()
    expect(await res.json()).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('POST /api/deposits', () => {
  it('creates a deposit and returns 201', async () => {
    const res = await POST(postReq(minValidBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ref).toBe('DEP/0001')
    expect(body.customerId).toBe(CUSTOMER_ID)
  })

  it('passes the parsed payload to the deposit service', async () => {
    await POST(postReq(minValidBody))
    expect(mockCreateDepositWithReceipt).toHaveBeenCalledWith(expect.objectContaining({
      ref: 'DEP/0002',
      customerId: CUSTOMER_ID,
      amount: 20000,
      method: 'mpesa',
      actor: { id: USER_ID, name: 'Finance Officer' },
    }))
    expect(mockCreateDepositWithReceipt.mock.calls[0][0].items[0]).toMatchObject({
      productId: 'prod1', qty: 1, unitPrice: 80000,
    })
  })

  it('keeps a client-supplied reference when present', async () => {
    await POST(postReq({ ...minValidBody, ref: 'DEP/CUSTOM-1' }))
    expect(mockCreateDepositWithReceipt).toHaveBeenCalledWith(expect.objectContaining({ ref: 'DEP/CUSTOM-1' }))
    expect(mockGetNextDepositRef).not.toHaveBeenCalled()
  })

  it('returns 422 when customerId is missing', async () => {
    const { customerId: _1, ...body } = minValidBody
    const res = await POST(postReq(body))
    expect(res.status).toBe(422)
    expect(mockCreateDepositWithReceipt).not.toHaveBeenCalled()
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

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockRejectedValue(err401())
    const res = await POST(postReq(minValidBody))
    expect(res.status).toBe(401)
  })

  it('returns 403 when a non-finance role attempts to create a deposit', async () => {
    mockRequireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    const res = await POST(postReq(minValidBody))
    expect(res.status).toBe(403)
  })
})
