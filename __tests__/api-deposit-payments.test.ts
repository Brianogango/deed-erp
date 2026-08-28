/**
 * Route-level tests for POST /api/deposits/:id/payments.
 * The route delegates to addDepositReceipt (deposit-service) — the business
 * rules (balance capping, status transitions) are covered in
 * deposit-service.test.ts. Here we assert input mapping, response mapping,
 * and that service failures surface as actionable 404/422 responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockAddDepositReceipt } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAddDepositReceipt: vi.fn(),
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
}))

vi.mock('@/lib/accounting/deposit-service', () => ({
  addDepositReceipt: mockAddDepositReceipt,
}))

import { POST } from '@/app/api/deposits/[id]/payments/route'

const DEPOSIT_ID = 'dep00001-0000-4000-8000-000000000001'
const USER_ID = 'user0001-0000-4000-8000-000000000001'
const session = { user: { id: USER_ID, name: 'Finance Officer', username: 'finance', role: 'finance_officer' } }

const serviceRow = {
  id: DEPOSIT_ID,
  ref: 'DEP/0001',
  totalValue: 80000,
  totalPaid: 40000,
  balance: 40000,
  status: 'partially_paid',
  items: [],
  payments: [],
}

function postReq(depositId: string, body: unknown): Request {
  return new Request(`http://localhost/api/deposits/${depositId}/payments`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(session)
  mockAddDepositReceipt.mockResolvedValue(serviceRow)
})

describe('POST /api/deposits/:id/payments', () => {
  it('maps the request body onto the service call', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 20000, method: 'mpesa', ref: 'ABC123', idempotencyKey: 'k-1' }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(200)
    expect(mockAddDepositReceipt).toHaveBeenCalledWith(expect.objectContaining({
      depositId: DEPOSIT_ID,
      amount: 20000,
      method: 'mpesa',
      paymentRef: 'ABC123',
      idempotencyKey: 'k-1',
      actor: { id: USER_ID, name: 'Finance Officer' },
    }))
  })

  it('defaults the method to cash and nulls optional fields', async () => {
    await POST(postReq(DEPOSIT_ID, { amount: 1000 }), { params: { id: DEPOSIT_ID } })
    expect(mockAddDepositReceipt).toHaveBeenCalledWith(expect.objectContaining({
      method: 'cash',
      paymentRef: null,
      bankAccountId: null,
      idempotencyKey: null,
    }))
  })

  it('returns the updated deposit with numeric totals', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 20000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    expect(body.ref).toBe('DEP/0001')
    expect(body.totalPaid).toBe(40000)
    expect(body.balance).toBe(40000)
  })

  it('returns 404 when the deposit does not exist', async () => {
    mockAddDepositReceipt.mockRejectedValue(Object.assign(new Error('No record found'), { code: 'P2025' }))
    const res = await POST(postReq('missing-id', { amount: 100 }), { params: { id: 'missing-id' } })
    expect(res.status).toBe(404)
  })

  it('returns 422 when the deposit status rejects payments', async () => {
    mockAddDepositReceipt.mockRejectedValue(new Error('Cannot add payment to a deposit in this status'))
    const res = await POST(postReq(DEPOSIT_ID, { amount: 100 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
    expect(String((await res.json()).error)).toContain('status')
  })

  it('returns 422 for a zero amount rejected by the service', async () => {
    mockAddDepositReceipt.mockRejectedValue(new Error('Payment amount must be greater than zero'))
    const res = await POST(postReq(DEPOSIT_ID, { amount: 0 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await POST(postReq(DEPOSIT_ID, { amount: 100 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(401)
  })
})
