import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetSession,
  mockPrisma,
  mockNotifyApplied,
  mockNotifyDecision,
  mockNotifyDisbursed,
  mockQueue,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    salaryAdvance: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    employee: { findFirst: vi.fn() },
  },
  mockNotifyApplied: vi.fn(),
  mockNotifyDecision: vi.fn(),
  mockNotifyDisbursed: vi.fn(),
  mockQueue: vi.fn((task: () => Promise<void>) => { void task() }),
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
vi.mock('@/lib/hr/salary-advance-notifications', () => ({
  notifySalaryAdvanceApplied: mockNotifyApplied,
  notifySalaryAdvanceDecision: mockNotifyDecision,
  notifySalaryAdvanceDisbursed: mockNotifyDisbursed,
  queueSalaryAdvanceNotification: mockQueue,
  toSalaryAdvanceNotifyPayload: (row: any) => ({
    id: row.id,
    ref: row.reference || row.ref || row.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName || 'Employee',
    amount: Number(row.amount) || 0,
    status: row.status,
  }),
}))

import { GET, POST } from '@/app/api/salary-advances/route'
import { PUT } from '@/app/api/salary-advances/[id]/route'

const techSession = { user: { id: 'u-tech', name: 'Tech', role: 'technician' } }
const financeSession = { user: { id: 'u-fin', name: 'Fin', role: 'finance_officer' } }

const jsonReq = (body: unknown) => new Request('http://localhost/api/salary-advances', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  mockQueue.mockImplementation((task: () => Promise<void>) => { void task() })
  mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-tech' })
  mockPrisma.salaryAdvance.findMany.mockResolvedValue([])
  mockPrisma.salaryAdvance.create.mockImplementation(({ data }: any) => Promise.resolve({
    id: 'adv1',
    employeeId: data.employeeId,
    employeeName: data.employeeName || 'Tech',
    amount: data.amount,
    requestedDate: new Date(),
    deductions: [],
    ...data,
  }))
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
  it('persists the client-provided id when present', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const res = await POST(jsonReq({ id, employeeId: 'emp-tech', amount: 5000, ref: 'ADV/0009' }))
    expect(res.status).toBe(201)
    expect(mockPrisma.salaryAdvance.create.mock.calls[0][0].data.id).toBe(id)
    expect(mockPrisma.salaryAdvance.create.mock.calls[0][0].data.reference).toBe('ADV/0009')
  })
  it('queues HR email notification after create', async () => {
    mockGetSession.mockResolvedValue(techSession)
    await POST(jsonReq({ employeeId: 'emp-tech', amount: 5000, employeeName: 'Tech' }))
    expect(mockQueue).toHaveBeenCalled()
    expect(mockNotifyApplied).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'emp-tech',
      amount: 5000,
    }))
  })
  it('rejects non-positive amount', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(jsonReq({ employeeId: 'emp-tech', amount: 0 }))
    expect(res.status).toBe(422)
    expect(mockNotifyApplied).not.toHaveBeenCalled()
  })
})

describe('PUT /api/salary-advances/[id] lifecycle', () => {
  it('blocks a technician from approving', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'pending' })
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'decide', approved: true }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(403)
  })
  it('lets finance approve a pending advance and emails applicant', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'pending', amount: 5000, employeeId: 'emp-tech' })
    mockPrisma.salaryAdvance.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'adv1', requestedDate: new Date(), deductions: [], amount: 5000, employeeId: 'emp-tech', ...data }))
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'decide', approved: true }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(200)
    expect(mockPrisma.salaryAdvance.update.mock.calls[0][0].data.status).toBe('approved')
    expect(mockNotifyDecision).toHaveBeenCalledWith(expect.objectContaining({ id: 'adv1' }), 'approved')
  })
  it('emails applicant when advance is disbursed', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'approved', amount: 5000, outstandingAmount: 5000, employeeId: 'emp-tech' })
    mockPrisma.salaryAdvance.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'adv1', amount: 5000, employeeId: 'emp-tech', ...data }))
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'pay' }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(200)
    expect(mockNotifyDisbursed).toHaveBeenCalledWith(expect.objectContaining({ id: 'adv1', status: 'paid' }))
  })
  it('refuses to pay an advance that is not approved', async () => {
    mockGetSession.mockResolvedValue(financeSession)
    mockPrisma.salaryAdvance.findUnique.mockResolvedValue({ id: 'adv1', status: 'pending', amount: 5000 })
    const res = await PUT(new Request('http://localhost/x', { method: 'PUT', body: JSON.stringify({ action: 'pay' }) }), { params: { id: 'adv1' } })
    expect(res.status).toBe(409)
    expect(mockNotifyDisbursed).not.toHaveBeenCalled()
  })
})
