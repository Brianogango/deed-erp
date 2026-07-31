import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetServerSession, mockPrisma, mockNotifyLeaveDecision } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockNotifyLeaveDecision: vi.fn(),
  mockPrisma: {
    leaveRequest: { findUnique: vi.fn(), update: vi.fn() },
    leaveBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    employee: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/hr/leave-notifications', () => ({
  notifyLeaveDecision: mockNotifyLeaveDecision,
  queueLeaveNotification: (task: () => Promise<void>) => { void task() },
  toLeaveNotifyPayload: (row: any) => ({
    id: row.id,
    ref: row.reference,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    leaveType: row.leaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    days: Number(row.daysRequested),
    reason: row.reason,
    status: row.status,
    reviewerName: row.reviewedByName,
    reviewNotes: row.reviewNotes,
  }),
}))

import { PUT } from '@/app/api/leave-requests/[id]/route'
import { NextRequest } from 'next/server'
import { notifyLeaveDecision } from '@/lib/hr/leave-notifications'

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
})

describe('PUT /api/leave-requests/[id] — no self-approval', () => {
  it('lets a director approve someone else\'s request', async () => {
    const res = await PUT(putReq({ status: 'approved', reviewNotes: 'OK' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalled()
    expect(notifyLeaveDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lr-1' }),
      'approved',
    )
  })

  it('emails the applicant on reject', async () => {
    const res = await PUT(putReq({ status: 'rejected', reviewNotes: 'No cover' }), { params: { id: 'lr-1' } })
    expect(res.status).toBe(200)
    expect(notifyLeaveDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lr-1' }),
      'rejected',
    )
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
