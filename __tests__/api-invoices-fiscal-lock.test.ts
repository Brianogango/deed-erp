import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockCheckFiscalLock,
  mockPrismaInvoice,
  mockResolveClientId,
  mockGetNextDocNumber,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCheckFiscalLock: vi.fn(),
  mockPrismaInvoice: { create: vi.fn(), findMany: vi.fn() },
  mockResolveClientId: vi.fn(),
  mockGetNextDocNumber: vi.fn(),
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
  getRequiredSession: mockGetSession,
  requireRole: mockGetSession,
}))

vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: mockCheckFiscalLock }))
vi.mock('@/lib/prisma', () => ({ default: { invoice: mockPrismaInvoice } }))
vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) => (typeof v === 'string' ? v : undefined),
}))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))

import { POST } from '@/app/api/invoices/route'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ id: 'u1', role: 'director' })
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
  mockGetNextDocNumber.mockResolvedValue('INV-1')
  mockCheckFiscalLock.mockResolvedValue({ ok: true })
  mockPrismaInvoice.create.mockResolvedValue({
    id: 'inv-1', invoiceNumber: 'INV-1', totalAmount: 1000, status: 'draft', items: [],
  })
})

describe('POST /api/invoices fiscal lock', () => {
  it('returns 409 when the invoice date is fiscal-locked', async () => {
    mockCheckFiscalLock.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Fiscal period locked through 2026-03-31 — backdated documents are not allowed',
    })
    const res = await POST(new Request('http://localhost/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        clientId: CLIENT_ID,
        date: '2026-03-01',
        dueDate: '2026-03-31',
        totalAmount: 1000,
        lines: [{ description: 'Item', qty: 1, unitPrice: 1000, taxRate: 0 }],
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(409)
    expect(mockPrismaInvoice.create).not.toHaveBeenCalled()
  })

  it('creates the invoice when the date is after the lock', async () => {
    const res = await POST(new Request('http://localhost/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        clientId: CLIENT_ID,
        date: '2026-04-15',
        dueDate: '2026-05-15',
        totalAmount: 1000,
        lines: [{ description: 'Item', qty: 1, unitPrice: 1000, taxRate: 0 }],
      }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(201)
    expect(mockCheckFiscalLock).toHaveBeenCalled()
  })
})
