import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockPrisma, mockLoadAppState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    user: { findMany: vi.fn() },
    salesCommission: { findMany: vi.fn() },
  },
  mockLoadAppState: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => handler(),
  getRequiredSession: mockGetSession,
}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState }))

import { GET } from '@/app/api/salesperson-sales/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'dir', role: 'director', name: 'Dir' } })
  mockLoadAppState.mockResolvedValue({
    deed_saleOrders: [
      { id: 'so1', ref: 'SO/0001', status: 'sale', date: '2026-08-21', total: 10000, salespersonId: 'joseph', salespersonName: 'Joseph', customerName: 'Acme' },
    ],
    deed_posOrders: [
      { id: 'p1', ref: 'POS/0039', date: '2026-08-22', total: 30001, salespersonId: 'joseph', salespersonName: 'Joseph', createdByUserId: 'cynthia', customerName: 'Nm Engineering' },
      { id: 'p2', ref: 'POS/0032', date: '2026-07-19', total: 19500, createdByUserId: 'cynthia', createdByName: 'Cynthia' },
    ],
  })
  mockPrisma.user.findMany.mockResolvedValue([
    { id: 'joseph', employeeId: 'emp-j', name: 'Joseph' },
  ])
  mockPrisma.salesCommission.findMany.mockResolvedValue([
    { employeeId: 'emp-j', commissionAmount: 150 },
  ])
})

describe('GET /api/salesperson-sales', () => {
  it('returns POS and closed SO totals for the closer even when commission is small', async () => {
    const res = await GET(new Request('http://localhost/api/salesperson-sales?periodYear=2026&periodMonth=8'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.map((item: { ref: string }) => item.ref)).toEqual(['POS/0039', 'SO/0001'])
    expect(body.byCloser).toEqual([
      expect.objectContaining({
        closerId: 'joseph',
        salesCount: 2,
        saleAmount: 40001,
        commissionAmount: 150,
      }),
    ])
    expect(body.summary).toMatchObject({ salesCount: 2, saleAmount: 40001, commissionAmount: 150 })
  })
})
