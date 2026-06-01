/**
 * Tests for POST /api/deposits/:id/payments
 *
 * This is the most business-logic-dense store-based route:
 * - Looks up existing deposit by id
 * - Caps payment amount at remaining balance (prevents overpayment)
 * - Recalculates totalPaid, balance, and status
 * - Transitions partially_paid → fully_paid when balance reaches 0
 * - Rejects payments on deposits that are already fully_paid/completed/cancelled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
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

// ── Import (after mocks) ──────────────────────────────────────────────────────
import { POST } from '@/app/api/deposits/[id]/payments/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const DEPOSIT_ID = 'dep00001-0000-4000-8000-000000000001'
const USER_ID    = 'user0001-0000-4000-8000-000000000001'

const session = { user: { id: USER_ID, name: 'Finance Officer', username: 'finance', role: 'finance_officer' } }

function makeDeposit(overrides: Partial<{
  id: string; status: string; totalPaid: number; balance: number; totalValue: number; payments: any[]
}> = {}) {
  return {
    id: DEPOSIT_ID,
    ref: 'DEP/0001',
    customerId: 'cust-001',
    customerName: 'John Doe',
    customerPhone: '+254700000001',
    items: [{ productId: 'p1', productName: 'Laptop', sku: 'L1', qty: 1, unitPrice: 80000, total: 80000 }],
    totalValue: 80000,
    totalPaid: 20000,
    balance: 60000,
    status: 'partially_paid',
    payments: [
      { id: 'pay-0001', date: '2026-01-01', amount: 20000, method: 'mpesa', recordedBy: 'Finance Officer' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Finance Officer',
    ...overrides,
  }
}

function postReq(depositId: string, body: unknown): Request {
  return new Request(`http://localhost/api/deposits/${depositId}/payments`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(session)
  mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [makeDeposit()] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

// ── Authentication ────────────────────────────────────────────────────────────
describe('POST /api/deposits/:id/payments — auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await POST(postReq(DEPOSIT_ID, { amount: 10000, method: 'cash' }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(401)
  })
})

// ── Not found ─────────────────────────────────────────────────────────────────
describe('POST /api/deposits/:id/payments — not found', () => {
  it('returns 404 when deposit id does not exist', async () => {
    const res = await POST(postReq('nonexistent-id', { amount: 5000 }), { params: { id: 'nonexistent-id' } })
    expect(res.status).toBe(404)
  })
})

// ── Status guard ──────────────────────────────────────────────────────────────
describe('POST /api/deposits/:id/payments — status guard', () => {
  it('returns 422 when deposit is already fully_paid', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [makeDeposit({ status: 'fully_paid', balance: 0 })] })
    const res = await POST(postReq(DEPOSIT_ID, { amount: 1000 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('status')
  })

  it('returns 422 when deposit is completed', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [makeDeposit({ status: 'completed' })] })
    const res = await POST(postReq(DEPOSIT_ID, { amount: 1000 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
  })

  it('returns 422 when deposit is cancelled', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [makeDeposit({ status: 'cancelled' })] })
    const res = await POST(postReq(DEPOSIT_ID, { amount: 1000 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
  })

  it('allows payment on partially_paid deposit', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 10000, method: 'cash' }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(200)
  })

  it('allows payment on active deposit', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [makeDeposit({ status: 'active' })] })
    const res = await POST(postReq(DEPOSIT_ID, { amount: 10000, method: 'cash' }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(200)
  })
})

// ── Amount validation ─────────────────────────────────────────────────────────
describe('POST /api/deposits/:id/payments — amount validation', () => {
  it('returns 422 when amount is 0', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 0 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('greater than 0')
  })

  it('returns 422 when amount is negative', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: -500 }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
  })

  it('returns 422 when amount is not provided', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { method: 'cash' }), { params: { id: DEPOSIT_ID } })
    expect(res.status).toBe(422)
  })
})

// ── Balance recalculation ─────────────────────────────────────────────────────
describe('POST /api/deposits/:id/payments — balance recalculation', () => {
  // Deposit fixture: totalPaid=20000, balance=60000, totalValue=80000

  it('adds payment amount to totalPaid', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 15000, method: 'mpesa' }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    expect(body.totalPaid).toBe(35000) // 20000 + 15000
  })

  it('subtracts payment amount from balance', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 15000, method: 'mpesa' }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    expect(body.balance).toBe(45000) // 60000 - 15000
  })

  it('status remains partially_paid when balance > 0', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 10000 }), { params: { id: DEPOSIT_ID } })
    expect((await res.json()).status).toBe('partially_paid')
  })

  it('status transitions to fully_paid when exact remaining balance is paid', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 60000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    expect(body.status).toBe('fully_paid')
    expect(body.balance).toBe(0)
    expect(body.totalPaid).toBe(80000)
  })

  it('status transitions to fully_paid when payment exceeds balance (capped)', async () => {
    // Route caps payment at remaining balance — 80000 > 60000 → treated as 60000
    const res = await POST(postReq(DEPOSIT_ID, { amount: 80000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    expect(body.status).toBe('fully_paid')
    expect(body.balance).toBe(0)
  })

  it('actual payment is capped at remaining balance (prevents overpayment)', async () => {
    // balance = 60000; paying 80000 → actual payment recorded = 60000
    const res = await POST(postReq(DEPOSIT_ID, { amount: 80000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    const lastPayment = body.payments[body.payments.length - 1]
    expect(lastPayment.amount).toBe(60000) // capped, not 80000
  })
})

// ── Payment entry creation ────────────────────────────────────────────────────
describe('POST /api/deposits/:id/payments — payment entry', () => {
  it('appends a new payment entry to the payments array', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 10000, method: 'bank_transfer' }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    expect(body.payments).toHaveLength(2) // 1 existing + 1 new
  })

  it('new payment has a valid UUID id', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 10000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    const lastPayment = body.payments[body.payments.length - 1]
    expect(lastPayment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('records payment method', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 5000, method: 'bank_transfer' }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    const lastPayment = body.payments[body.payments.length - 1]
    expect(lastPayment.method).toBe('bank_transfer')
  })

  it('defaults payment method to "cash" when not provided', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 5000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    const lastPayment = body.payments[body.payments.length - 1]
    expect(lastPayment.method).toBe('cash')
  })

  it('records the session user as recordedBy', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 5000 }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    const lastPayment = body.payments[body.payments.length - 1]
    expect(lastPayment.recordedBy).toBe('Finance Officer')
  })

  it('includes optional payment ref when provided', async () => {
    const res = await POST(postReq(DEPOSIT_ID, { amount: 5000, ref: 'MPESA-ABC123' }), { params: { id: DEPOSIT_ID } })
    const body = await res.json()
    const lastPayment = body.payments[body.payments.length - 1]
    expect(lastPayment.ref).toBe('MPESA-ABC123')
  })

  it('persists the updated deposit list to store', async () => {
    await POST(postReq(DEPOSIT_ID, { amount: 10000 }), { params: { id: DEPOSIT_ID } })
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(
      expect.objectContaining({ deed_deposits_v1: expect.any(String) })
    )
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_deposits_v1)
    const updatedDeposit = saved.find((d: any) => d.id === DEPOSIT_ID)
    expect(updatedDeposit.totalPaid).toBe(30000)
  })

  it('preserves other deposits in the store when updating one', async () => {
    const otherDeposit = makeDeposit({ id: 'other-dep-id' })
    mockLoadAppState.mockResolvedValue({ deed_deposits_v1: [makeDeposit(), otherDeposit] })
    await POST(postReq(DEPOSIT_ID, { amount: 5000 }), { params: { id: DEPOSIT_ID } })
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_deposits_v1)
    expect(saved).toHaveLength(2)
    const otherInStore = saved.find((d: any) => d.id === 'other-dep-id')
    expect(otherInStore.totalPaid).toBe(20000) // unchanged
  })
})
