import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireRole, mockApply } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockApply: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<Response>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status })
    }
  },
  requireRole: mockRequireRole,
}))
vi.mock('@/lib/accounting/deposit-service', () => ({ applyDepositToInvoice: mockApply }))

import { POST } from '@/app/api/deposits/[id]/complete/route'

const INVOICE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const complete = (body: unknown) =>
  POST(
    new Request('http://localhost/api/deposits/dep-1/complete', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'dep-1' }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'u1', name: 'Fin', role: 'finance_officer' })
  mockApply.mockResolvedValue({ depositId: 'dep-1', applied: 20_000 })
})

describe('POST /api/deposits/[id]/complete', () => {
  it('applies the deposit to the invoice it names', async () => {
    const res = await complete({ invoiceId: INVOICE_ID, amount: 20_000 })
    expect(res.status).toBe(200)
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      depositId: 'dep-1',
      invoiceId: INVOICE_ID,
      amount: 20_000,
    }))
  })

  it('applies the whole balance when no amount is given', async () => {
    await complete({ invoiceId: INVOICE_ID })
    expect(mockApply.mock.calls[0][0].amount).toBeUndefined()
  })

  it('refuses to complete a deposit with no invoice', async () => {
    // A deposit is a liability until the sale is invoiced. Clearing 3100
    // straight into revenue skips VAT and the AR subledger, so the route has
    // no path that recognises revenue on its own — the client used to send an
    // empty body here and swallow the refusal, leaving the liability looking
    // cleared while nothing had been posted.
    const res = await complete({})
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/invoiceId is required/i)
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('refuses an amount that is zero or negative', async () => {
    expect((await complete({ invoiceId: INVOICE_ID, amount: 0 })).status).toBe(422)
    expect((await complete({ invoiceId: INVOICE_ID, amount: -5 })).status).toBe(422)
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('refuses an unknown field rather than ignoring it', async () => {
    const res = await complete({ invoiceId: INVOICE_ID, recogniseRevenue: true })
    expect(res.status).toBe(422)
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('passes a service refusal back to the caller', async () => {
    mockApply.mockRejectedValue(Object.assign(new Error('Deposit already completed'), { status: 409 }))
    const res = await complete({ invoiceId: INVOICE_ID })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Deposit already completed')
  })
})
