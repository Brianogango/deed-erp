import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetServerSession, mockPrisma } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockPrisma: {
    leaveRequest: { findUnique: vi.fn(), update: vi.fn() },
    leaveBalance: { findUnique: vi.fn(), upsert: vi.fn() },
    employee: { findFirst: vi.fn(), findUnique: vi.fn() },
    // notification service publishes inside prisma.$transaction
    notificationEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'evt-test' }), update: vi.fn() },
    notificationRecipient: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn() },
    notificationOutbox: { create: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    $transaction: vi.fn((fn: any) => fn(mockPrisma)),
  },
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

// The route publishes through the notification platform (hr-events →
// notification service).
const { mockPublishLeaveDecision, mockPublishLeaveCancelled } = vi.hoisted(() => ({
  mockPublishLeaveDecision: vi.fn(),
  mockPublishLeaveCancelled: vi.fn(),
}))
vi.mock('@/lib/notifications/hr-events', () => ({
  publishLeaveDecision: mockPublishLeaveDecision,
  publishLeaveCancelled: mockPublishLeaveCancelled,
}))

import { PUT } from '@/app/api/leave-requests/[id]/route'
import { NextRequest } from 'next/server'
import { publishLeaveDecision } from '@/lib/notifications/hr-events'

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
    const res = await PUT(putReq({ status: 'approved', reviewNotes: 'OK' }), { params: Promise.resolve({ id: 'lr-1' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalled()
    expect(publishLeaveDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lr-1' }),
      'approved',
      'u-director',
    )
  })

  it('emails the applicant on reject', async () => {
    const res = await PUT(putReq({ status: 'rejected', reviewNotes: 'No cover' }), { params: Promise.resolve({ id: 'lr-1' }) })
    expect(res.status).toBe(200)
    expect(publishLeaveDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lr-1' }),
      'rejected',
      'u-director',
    )
  })

  it('blocks approving a request the caller submitted themselves', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow, submittedByUserId: 'u-director' })
    const res = await PUT(putReq({ status: 'approved' }), { params: Promise.resolve({ id: 'lr-1' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it('blocks approving a request for the caller\'s own employee record', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-a' })
    const res = await PUT(putReq({ status: 'approved' }), { params: Promise.resolve({ id: 'lr-1' }) })
    expect(res.status).toBe(403)
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it('blocks rejecting one\'s own request too', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow, submittedByUserId: 'u-director' })
    const res = await PUT(putReq({ status: 'rejected' }), { params: Promise.resolve({ id: 'lr-1' }) })
    expect(res.status).toBe(403)
  })

  it('still allows cancelling one\'s own request', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow, submittedByUserId: 'u-director' })
    const res = await PUT(putReq({ status: 'cancelled' }), { params: Promise.resolve({ id: 'lr-1' }) })
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalled()
  })
})

// Approved leave the employee did not take, or cut short.
describe('PUT /api/leave-requests/[id] — leave not taken or cut short', () => {
  // Mon 3 Aug – Fri 7 Aug 2026: 5 working days, all used.
  const approved = { ...pendingRow, status: 'approved', startDate: new Date('2026-08-03'), endDate: new Date('2026-08-07'), daysRequested: 5, reviewNotes: 'Approved' }
  const balanceRow = { employeeId: 'emp-a', leaveType: 'annual', year: 2026, entitlement: 21, carryForward: 0, pending: 0, used: 5 }
  const params = { params: Promise.resolve({ id: 'lr-1' }) }

  beforeEach(() => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...approved })
    mockPrisma.leaveRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ ...approved, ...data }))
    mockPrisma.leaveBalance.findUnique.mockResolvedValue({ ...balanceRow })
  })

  it('came back early: the leave ends on the last day taken and the rest goes back', async () => {
    const res = await PUT(putReq({ action: 'return_early', lastDayTaken: '2026-08-04', note: 'Called back' }), params)
    expect(res.status).toBe(200)
    expect((await res.json()).returnedDays).toBe(3)
    expect(mockPrisma.leaveBalance.upsert.mock.calls[0][0].update).toEqual({ pending: 0, used: 2 })
    const data = mockPrisma.leaveRequest.update.mock.calls[0][0].data
    expect(data.daysRequested).toBe(2)
    expect(data.endDate.toISOString().slice(0, 10)).toBe('2026-08-04')
    expect(data.reviewNotes).toContain('Returned early')
    expect(data.reviewNotes).toContain('Approved')
  })

  it('refuses a last day outside the leave, or leave that is not approved', async () => {
    for (const lastDayTaken of ['2026-08-01', '2026-08-07', 'soon']) {
      expect((await PUT(putReq({ action: 'return_early', lastDayTaken }), params)).status).toBe(422)
    }
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRow })
    expect((await PUT(putReq({ action: 'return_early', lastDayTaken: '2026-08-04' }), params)).status).toBe(409)
    expect(mockPrisma.leaveBalance.upsert).not.toHaveBeenCalled()
  })

  it('not taken at all: cancelling returns every day', async () => {
    const res = await PUT(putReq({ request: { status: 'cancelled', reviewNotes: 'Leave not taken' } }), params)
    expect(res.status).toBe(200)
    expect(mockPrisma.leaveBalance.upsert.mock.calls[0][0].update).toEqual({ pending: 0, used: 0 })
  })

  it('nobody gives their own approved leave days back', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-a' })
    expect((await PUT(putReq({ action: 'return_early', lastDayTaken: '2026-08-04' }), params)).status).toBe(403)
    expect((await PUT(putReq({ request: { status: 'cancelled' } }), params)).status).toBe(403)
    expect(mockPrisma.leaveBalance.upsert).not.toHaveBeenCalled()
  })
})
