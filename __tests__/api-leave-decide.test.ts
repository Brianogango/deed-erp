import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetServerSession, mockPrisma, mockNotifyDecision } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockPrisma: {
    leaveRequest: { findUnique: vi.fn(), update: vi.fn() },
    leaveBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    employee: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
  mockNotifyDecision: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/integrations/leave-notifications', () => ({
  notifyLeaveDecision: mockNotifyDecision,
}))

import { PUT } from '@/app/api/leave-requests/[id]/route'
import { NextRequest } from 'next/server'

const directorSession = { user: { id: 'u-director', name: 'Director', username: 'director', role: 'director' } }

const pendingRow = {
  id: 'lr-1', reference: 'LV/0031', employeeId: 'emp-a', employeeName: 'Ann A',
  leaveType: 'annual', startDate: new Date('2026-08-03'), endDate: new Date('2026-08-04'),
  daysRequested: 2, reason: 'x', status: 'pending_hr', reviewedByName: null, reviewedAt: null,
  submittedByUserId: 'u-a', isSystemGenerated: false, createdAt: new Date(),
}

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/leave-requests/lr-1', {
    method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(directorSession)
  mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow })
  mockPrisma.leaveRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ ...pendingRow, ...data }))
  mockPrisma.leaveBalance.findUnique.mockResolvedValue(null)
  mockPrisma.leaveBalance.upsert.mockResolvedValue({})
  mockPrisma.employee.findUnique.mockResolvedValue({ gender: null })
  mockPrisma.employee.findFirst.mockResolvedValue(null)
  mockNotifyDecision.mockResolvedValue({ attempted: true, success: true, recipients: ['ann@example.test'] })
})

describe('PUT /api/leave-requests/[id] — no self-approval', () => {
  it('lets a director approve someone else\'s request', async () => {
    const res = await PUT(putReq({ status: 'approved' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalled()
    expect(mockNotifyDecision).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'lr-1',
      status: 'approved',
      reviewerName: 'Director',
    }))
  })

  it('persists and emails the decision note supplied outside the client request shape', async () => {
    const res = await PUT(putReq({ request: { status: 'rejected' }, reviewNotes: 'Insufficient cover' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewNotes: 'Insufficient cover' }),
    }))
    expect(mockNotifyDecision).toHaveBeenCalledWith(expect.objectContaining({
      status: 'rejected',
      note: 'Insufficient cover',
    }))
  })

  it('blocks approving a request the caller submitted themselves', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow, submittedByUserId: 'u-director' })
    const res = await PUT(putReq({ status: 'approved' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(403)
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it('blocks approving a request for the caller\'s own employee record', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-a' })
    const res = await PUT(putReq({ status: 'approved' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(403)
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it('blocks rejecting one\'s own request too', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow, submittedByUserId: 'u-director' })
    const res = await PUT(putReq({ status: 'rejected' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(403)
  })

  it('still allows cancelling one\'s own request', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow, submittedByUserId: 'u-director' })
    const res = await PUT(putReq({ status: 'cancelled' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalled()
  })
})
