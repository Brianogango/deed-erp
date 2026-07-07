import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockLoadAppState, mockSaveStoreKeys, mockEmployeeFindFirst } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockEmployeeFindFirst: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
  getRequiredSession: mockGetSession,
}))

vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState, saveStoreKeys: mockSaveStoreKeys }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: { employee: { findFirst: mockEmployeeFindFirst } } }))

import { POST } from '@/app/api/leave-requests/route'

const techSession = { user: { id: 'u-tech', name: 'Tech', username: 'tech', role: 'technician' } }
const hrSession = { user: { id: 'u-hr', name: 'HR', username: 'hr', role: 'admin_officer' } }

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/leave-requests', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAppState.mockResolvedValue({ deed_leaveRequests: [], deed_leaveBalances: [] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockEmployeeFindFirst.mockResolvedValue({ id: 'emp-tech', firstName: 'Tim', lastName: 'Tech' })
})

describe('POST /api/leave-requests — self-service integrity', () => {
  it('forces status to pending_hr even if the client asks for approved', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'annual', days: 2, startDate: '2026-08-01', endDate: '2026-08-02', status: 'approved', employeeId: 'someone-else' }))
    expect(res.status).toBe(200)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_leaveRequests)
    expect(saved[0].status).toBe('pending_hr')
    // Employee is forced to the caller's own linked employee, not the injected id.
    expect(saved[0].employeeId).toBe('emp-tech')
  })

  it('rejects a self-service caller sending bulkRequests', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ bulkRequests: [{ id: 'x' }] }))
    expect(res.status).toBe(403)
  })

  it('rejects a self-service caller sending balance changes', async () => {
    mockGetSession.mockResolvedValue(techSession)
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-01', endDate: '2026-08-01', balances: [{ employeeId: 'emp-tech' }] }))
    expect(res.status).toBe(403)
  })

  it('rejects leave that exceeds the remaining entitlement', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockLoadAppState.mockResolvedValue({
      deed_leaveRequests: [],
      deed_leaveBalances: [{ id: 'b1', employeeId: 'emp-tech', leaveType: 'annual', year: 2026, entitlement: 5, carryForward: 0, used: 4, pending: 0 }],
    })
    const res = await POST(postReq({ leaveType: 'annual', days: 3, startDate: '2026-08-01', endDate: '2026-08-03' }))
    expect(res.status).toBe(422)
  })

  it('blocks a user with no employee profile', async () => {
    mockGetSession.mockResolvedValue(techSession)
    mockEmployeeFindFirst.mockResolvedValue(null)
    const res = await POST(postReq({ leaveType: 'annual', days: 1, startDate: '2026-08-01', endDate: '2026-08-01' }))
    expect(res.status).toBe(403)
  })

  it('lets HR submit bulk requests', async () => {
    mockGetSession.mockResolvedValue(hrSession)
    const res = await POST(postReq({ bulkRequests: [{ id: 'r1', employeeId: 'e1', status: 'approved' }] }))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })
})
