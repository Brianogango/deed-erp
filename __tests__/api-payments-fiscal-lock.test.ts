import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireRole, mockCheckFiscalLock, mockRecordPayment, mockBlobPost } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockCheckFiscalLock: vi.fn(),
  mockRecordPayment: vi.fn(),
  mockBlobPost: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status })
    }
  },
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: mockCheckFiscalLock }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/accounting/payment-allocations', () => ({
  recordPaymentWithAllocations: mockRecordPayment,
}))
vi.mock('@/lib/server-store-crud', () => ({
  makeCollectionHandlers: () => ({
    GET: vi.fn(),
    POST: mockBlobPost,
  }),
}))

import { POST } from '@/app/api/payments/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'finance_officer' })
  mockCheckFiscalLock.mockResolvedValue({ ok: true })
})

describe('POST /api/payments fiscal lock', () => {
  it('returns 409 for a backdated payment', async () => {
    mockCheckFiscalLock.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Fiscal period locked through 2026-03-31 — backdated documents are not allowed',
    })
    const res = await POST(new NextRequest('http://localhost/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 500,
        paidAt: '2026-02-01',
        allocations: [{ invoiceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 500 }],
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(409)
    expect(mockRecordPayment).not.toHaveBeenCalled()
  })

  it('accepts payments after the lock date', async () => {
    mockRecordPayment.mockResolvedValue({
      payment: { id: 'pay-1' },
      allocations: [{ invoiceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 500 }],
    })
    const res = await POST(new NextRequest('http://localhost/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        amount: 500,
        paidAt: '2026-04-15',
        allocations: [{ invoiceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 500 }],
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(200)
  })
})
