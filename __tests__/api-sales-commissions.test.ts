import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockPrisma } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    salesCommission: { count: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const message = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  getRequiredSession: mockGetSession,
}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { GET } from '@/app/api/sales-commissions/route'

const EMP_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

const ledgerRow = {
  id: 'row-1',
  employeeId: EMP_ID,
  invoiceId: 'inv-1',
  periodMonth: 8,
  periodYear: 2026,
  saleAmount: 10000,
  commissionRate: 5,
  commissionAmount: 500,
  isPaid: false,
  createdAt: new Date('2026-08-21T10:00:00Z'),
  employee: { firstName: 'Ada', lastName: 'Sales' },
  invoice: { invoiceNumber: 'INV/2026/0001' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'u1', role: 'director', name: 'Dir', username: 'dir' } })
  mockPrisma.salesCommission.count.mockResolvedValue(1)
  mockPrisma.salesCommission.findMany.mockResolvedValue([ledgerRow])
  mockPrisma.user.findMany.mockResolvedValue([{ employeeId: EMP_ID, name: 'Ada Closer' }])
})

describe('GET /api/sales-commissions', () => {
  it('returns all matching rows plus a summary when summary=1', async () => {
    const res = await GET(new Request('http://localhost/api/sales-commissions?summary=1&periodYear=2026&periodMonth=8'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      employeeId: EMP_ID,
      employeeName: 'Ada Closer',
      invoiceRef: 'INV/2026/0001',
      saleAmount: 10000,
      commissionRate: 5,
      commissionAmount: 500,
      isPaid: false,
    })
    expect(body.summary).toMatchObject({
      saleAmount: 10000,
      commissionAmount: 500,
      accrued: 500,
      paid: 0,
    })
    expect(mockPrisma.salesCommission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { periodYear: 2026, periodMonth: 8 },
      }),
    )
    const arg = mockPrisma.salesCommission.findMany.mock.calls[0][0]
    expect(arg.skip).toBeUndefined()
    expect(arg.take).toBeUndefined()
  })

  it('scopes non-finance users to their own employee ledger', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'rep-1', role: 'sales_rep', name: 'Rep', username: 'rep' } })
    mockPrisma.user.findUnique.mockResolvedValue({ employeeId: EMP_ID })
    await GET(new Request('http://localhost/api/sales-commissions?summary=1'))
    expect(mockPrisma.salesCommission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: EMP_ID } }),
    )
  })

  it('applies isPaid only when the query is true or false', async () => {
    await GET(new Request('http://localhost/api/sales-commissions?summary=1&isPaid=false'))
    expect(mockPrisma.salesCommission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isPaid: false } }),
    )
    await GET(new Request('http://localhost/api/sales-commissions?summary=1&isPaid=maybe'))
    expect(mockPrisma.salesCommission.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })
})
