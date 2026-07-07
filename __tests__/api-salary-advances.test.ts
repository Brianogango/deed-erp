import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockPrisma } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    salaryAdvance: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    employee: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (h: () => Promise<any>) => {
    try { return await h() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
  getRequiredSession: mockGetSession,
  requireRole: vi.fn(),
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { GET, POST } from '@/app/api/salary-advances/route'
import { PUT } from '@/app/api/salary-advances/[id]/route'

const techSession = { user: { id: 'u-tech', name: 'Tech', role: 'technician' } }
const financeSession = { user: { id: 'u-fin', name: 'Fin', role: 'finance_officer' } }

const jsonReq = (body: unknown) => new Request('http://localhost/api/salary-advances', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-tech' })
  mockPrisma.salaryAdvance.findMany.mockResolvedValue([])
  mockPrisma.salaryAdvance.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'adv1', requestedDate: new Date(), deductions: [], ...data }))
})

describe('GET /api/salary-advances scoping', () => {
  it('a technician only sees their own advances', async () => {
    mockGetSession.mockResolvedValue(techSession)
    await GET()
    expect(mockPrisma.salaryAdvance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: 'emp-tech' } }))
  })
  it('finance sees all advances', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    await GET()
    expect(mockPrisma.salaryAdvance.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: expect.anything() }))
  })
})

describe('POST /api/salary-advances', () => {
  it('forces status pending regardless of client input', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(jsonReq({ employeeId: 'emp-tech', amount: 5000, status: 'paid' }))
    expect(res.status).toBe(201)
    expect(mockPrisma.salaryAdvance.create.mock.calls[0][0].data.status).toBe('pending')
  })
  it('rejects non-positive amount', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(jsonReq({ employeeId: 'emp-tech', amount: 0 }))
    expect(res.status).toBe(422)
  })
})

describe('PUT /api/salary-advances/[id] lifecycle', () => {
  it('blocks a technician from approving', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'pending' })
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'decide', approved: true }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(403)
  })
  it('lets finance approve a pending advance', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'pending', amount: 5000 })
    mockPrisma.salaryAdvance.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'adv1', requestedDate: new Date(), deductions: [], amount: 5000, ...data }))
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'decide', approved: true }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(200)
    expect(mockPrisma.salaryAdvance.update.mock.calls[0][0].data.status).toBe('approved')
  })
  it('refuses to pay an advance that is not approved', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'pending', amount: 5000 })
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'pay' }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(409)
  })
})
