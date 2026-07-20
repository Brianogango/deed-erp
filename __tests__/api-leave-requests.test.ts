import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGetSession, mockPrisma } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    leaveRequest: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    leaveBalance: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    employee: { findFirst: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
  getRequiredSession: mockGetSession,
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { POST } from '@/app/api/leave-requests/route'

const techSession = { user: { id: 'u-tech', name: 'Tech', username: 'tech', role: 'technician' } }
const hrSession = { user: { id: 'u-hr', name: 'HR', username: 'hr', role: 'admin_officer' } }

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/leave-requests', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  // The notice-period rule compares the start date against "today" — pin the
  // clock so the August 2026 test dates always have sufficient notice.
  vi.useFakeTimers({ now: new Date('2026-07-01T09:00:00Z'), toFake: ['Date'] })
  mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-tech', firstName: 'Tim', lastName: 'Tech', gender: 'male' })
  mockPrisma.employee.findUnique.mockResolvedValue({ gender: 'male' })
  mockPrisma.leaveBalance.findUnique.mockResolvedValue(null)
  mockPrisma.leaveBalance.upsert.mockResolvedValue({})
  mockPrisma.leaveRequest.findFirst.mockResolvedValue(null)
  mockPrisma.leaveRequest.findUnique.mockResolvedValue(null)
  mockPrisma.$queryRaw.mockResolvedValue([{ n: 29 }])
  mockPrisma.leaveRequest.create.mockImplementation(({ data }: any) => Promise.resolve({
    ...data, id: 'new-id', createdAt: new Date(), startDate: new Date(data.startDate), endDate: new Date(data.endDate),
    reviewedAt: null, reviewedByName: null,
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/leave-requests — Prisma-backed self-service', () => {
  // 2026-08-03 is a Monday; 2026-08-01/02 fall on a weekend.
  it('forces pending_hr status and the caller\'s own employee id', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'annual', days: 2, startDate: '2026-08-03', endDate: '2026-08-04', status: 'approved', employeeId: 'someone-else' }))
    expect(res.status).toBe(200)
    const created = mockPrisma.leaveRequest.create.mock.calls[0][0].data
    expect(created.status).toBe('pending_hr')
    expect(created.employeeId).toBe('emp-tech')
    // Reserves the days as pending on the balance.
    expect(mockPrisma.leaveBalance.upsert).toHaveBeenCalled()
  })

  it('derives the day count from the date range, ignoring a client-sent days value', async () => {
    mockGetSession.mockResolvedValue(techSession)
    // Mon 3rd → Fri 7th = 5 working days, but the client claims just 1.
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-03', endDate: '2026-08-07' }))
    expect(res.status).toBe(200)
    const created = mockPrisma.leaveRequest.create.mock.calls[0][0].data
    expect(Number(created.daysRequested)).toBe(5)
  })

  it('rejects a date range containing no working days', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'annual', days: 2, startDate: '2026-08-01', endDate: '2026-08-02' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled()
  })

  it('rejects an end date before the start date', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-04', endDate: '2026-08-03' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled()
  })

  it('assigns a server-generated sequential reference, ignoring the client ref', async () => {
    mockGetSession.mockResolvedValue(techSession)
    // Client sends a stale per-browser ref that already exists in the DB.
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-03', endDate: '2026-08-03', ref: 'LV/0001' }))
    expect(res.status).toBe(200)
    const created = mockPrisma.leaveRequest.create.mock.calls[0][0].data
    expect(created.reference).toBe('LV/0030') // MAX existing (29) + 1
  })

  it('retries with a fresh reference when a concurrent insert wins the sequence number', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.leaveRequest.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce(({ data }: any) => Promise.resolve({
        ...data, id: 'new-id', createdAt: new Date(), startDate: new Date(data.startDate), endDate: new Date(data.endDate),
        reviewedAt: null, reviewedByName: null,
      }))
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ n: 29 }]).mockResolvedValueOnce([{ n: 30 }])
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-03', endDate: '2026-08-03' }))
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.leaveRequest.create.mock.calls[1][0].data.reference).toBe('LV/0031')
  })

  it('regenerates the reference when an HR booking supplies a duplicate ref', async () => {
    mockGetSession.mockResolvedValue(hrSession)
    mockPrisma.leaveRequest.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce(({ data }: any) => Promise.resolve({
        ...data, id: 'new-id', createdAt: new Date(), startDate: new Date(data.startDate), endDate: new Date(data.endDate),
        reviewedAt: null, reviewedByName: null,
      }))
    const res = await POST(postReq({ employeeId: 'emp-x', employeeName: 'X', leaveType: 'annual', days: 1, startDate: '2026-08-03', endDate: '2026-08-03', ref: 'LV/0001', status: 'approved' }))
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.create.mock.calls[0][0].data.reference).toBe('LV/0001')
    expect(mockPrisma.leaveRequest.create.mock.calls[1][0].data.reference).toBe('LV/0030')
  })

  it('rejects self-service bulk requests', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ bulkRequests: [{ id: 'x' }] }))
    expect(res.status).toBe(403)
  })

  it('ignores a stray balances snapshot on a self-service application (legacy clients)', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({
      leaveType: 'annual', days: 2, startDate: '2026-08-03', endDate: '2026-08-04',
      balances: [{ employeeId: 'emp-tech', leaveType: 'annual', year: 2026, entitlement: 999, used: 0, pending: 0, carryForward: 0 }],
    }))
    expect(res.status).toBe(200)
    const created = mockPrisma.leaveRequest.create.mock.calls[0][0].data
    expect(created.status).toBe('pending_hr')
    // The snapshot's inflated entitlement must never be written verbatim.
    const upserted = mockPrisma.leaveBalance.upsert.mock.calls.map((c: any[]) => c[0])
    expect(upserted.some((u: any) => Number(u.update?.entitlement) === 999 || Number(u.create?.entitlement) === 999)).toBe(false)
  })

  it('rejects leave exceeding remaining entitlement', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.leaveBalance.findUnique.mockResolvedValue({ id: 'b1', employeeId: 'emp-tech', leaveType: 'annual', year: 2026, entitlement: 5, carryForward: 0, used: 4, pending: 0 })
    // Mon–Wed = 3 working days, but only 1 day remains.
    const res = await POST(postReq({ leaveType: 'annual', days: 3, startDate: '2026-08-03', endDate: '2026-08-05' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled()
  })

  it('rejects leave when the balance is fully used up (zero remaining)', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.leaveBalance.findUnique.mockResolvedValue({ id: 'b1', employeeId: 'emp-tech', leaveType: 'annual', year: 2026, entitlement: 13, carryForward: 0, used: 13, pending: 0 })
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-03', endDate: '2026-08-03' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled()
  })

  it('allows unpaid leave without a balance check', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.leaveBalance.findUnique.mockResolvedValue({ id: 'b1', employeeId: 'emp-tech', leaveType: 'unpaid', year: 2026, entitlement: 0, carryForward: 0, used: 0, pending: 0 })
    const res = await POST(postReq({ leaveType: 'unpaid', days: 2, startDate: '2026-08-03', endDate: '2026-08-04' }))
    expect(res.status).toBe(200)
  })

  it('rejects overlapping dates', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.leaveRequest.findFirst.mockResolvedValue({ id: 'existing' })
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-03', endDate: '2026-08-03' }))
    expect(res.status).toBe(422)
  })

  it('blocks a user with no employee profile', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.employee.findFirst.mockResolvedValue(null)
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-01', endDate: '2026-08-01' }))
    expect(res.status).toBe(403)
  })

  it('lets HR create a booking that lands approved', async () => {
    mockGetSession.mockResolvedValue(hrSession)
    const res = await POST(postReq({ employeeId: 'emp-x', employeeName: 'X', leaveType: 'annual', days: 1, startDate: '2026-08-01', endDate: '2026-08-01', status: 'approved' }))
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.create).toHaveBeenCalled()
  })

  it('rejects maternity leave for a male employee', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'maternity', days: 5, startDate: '2026-08-01', endDate: '2026-08-05' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled()
  })

  it('rejects paternity leave for a female employee', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-tech', firstName: 'Tina', lastName: 'Tech', gender: 'female' })
    const res = await POST(postReq({ leaveType: 'paternity', days: 5, startDate: '2026-08-01', endDate: '2026-08-05' }))
    expect(res.status).toBe(422)
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled()
  })

  it('allows paternity leave for a male employee (two weeks)', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'paternity', days: 14, startDate: '2026-08-01', endDate: '2026-08-14' }))
    expect(res.status).toBe(200)
    const created = mockPrisma.leaveRequest.create.mock.calls[0][0].data
    expect(created.leaveType).toBe('paternity')
  })

  it('allows leave when gender is not recorded (no false blocks)', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-tech', firstName: 'Sam', lastName: 'Tech', gender: null })
    mockPrisma.employee.findUnique.mockResolvedValue({ gender: null })
    const res = await POST(postReq({ leaveType: 'maternity', days: 5, startDate: '2026-08-01', endDate: '2026-08-05' }))
    expect(res.status).toBe(200)
  })
})
