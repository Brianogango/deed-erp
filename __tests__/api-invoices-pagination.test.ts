import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockPrismaInvoice } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaInvoice: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
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
  requireRole: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: { invoice: mockPrismaInvoice } }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/fiscal-lock.server', () => ({
  checkFiscalLock: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: vi.fn(),
  optionalUuid: () => undefined,
}))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn() }))

import { GET } from '@/app/api/invoices/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'u1', role: 'director' } })
})

describe('GET /api/invoices pagination (PERF-001)', () => {
  it('returns paginated envelope with defaults', async () => {
    const rows = [{ id: 'inv-1', invoiceNumber: 'INV/1' }]
    mockPrismaInvoice.count.mockResolvedValue(1)
    mockPrismaInvoice.findMany.mockResolvedValue(rows)

    const res = await GET(new Request('http://localhost/api/invoices'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      items: rows,
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    })
    expect(mockPrismaInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    )
  })

  it('caps limit at 200 and supports page/sort/filter', async () => {
    mockPrismaInvoice.count.mockResolvedValue(500)
    mockPrismaInvoice.findMany.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/invoices?page=2&limit=500&status=posted&q=Acme&sort=totalAmount&order=asc'))
    const body = await res.json()
    expect(body.limit).toBe(200)
    expect(body.page).toBe(2)
    expect(body.total).toBe(500)
    expect(body.totalPages).toBe(3)
    expect(mockPrismaInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 200,
        take: 200,
        orderBy: { totalAmount: 'asc' },
        where: expect.objectContaining({
          status: 'approved',
          OR: expect.any(Array),
        }),
      }),
    )
  })
})
