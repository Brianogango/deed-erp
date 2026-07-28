import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma, mockSend } = vi.hoisted(() => ({
  mockPrisma: {
    employee: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
  mockSend: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/integrations/messaging', () => ({
  sendMultiChannelMessage: mockSend,
}))

import { notifyLeaveDecision, notifyLeaveSubmitted } from '@/lib/integrations/leave-notifications'

const details = {
  requestId: '11111111-1111-1111-1111-111111111111',
  reference: 'LV/0042',
  employeeId: '22222222-2222-2222-2222-222222222222',
  employeeName: 'Ann A',
  leaveType: 'annual',
  days: 2,
  startDate: new Date('2026-08-03'),
  endDate: new Date('2026-08-04'),
  reason: 'Family event',
  submittedByUserId: 'u-ann',
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.HR_EMAIL
  process.env.NEXT_PUBLIC_APP_URL = 'https://erp.example.test'
  mockSend.mockResolvedValue({
    success: true,
    results: { email: { channel: 'email', success: true, messageId: 'mail-1' } },
  })
})

describe('leave email notifications', () => {
  it('emails active leave approvers once using BCC', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({ user: { role: 'technician' } })
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u-director', email: 'director@example.test' },
      { id: 'u-lead', email: 'lead@example.test' },
      { id: 'u-ann', email: 'ann@example.test' },
    ])

    const result = await notifyLeaveSubmitted(details)

    expect(result.success).toBe(true)
    expect(result.recipients).toEqual(['director@example.test', 'lead@example.test'])
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      mailbox: 'hr',
      recipient: expect.objectContaining({ email: 'director@example.test' }),
      bcc: ['lead@example.test'],
      metadata: expect.objectContaining({ event: 'submitted', requestId: details.requestId }),
    }))
  })

  it('emails a decision to the employee email with linked-user fallback', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      firstName: 'Ann',
      lastName: 'A',
      email: null,
      user: { email: 'ann@example.test' },
    })

    const result = await notifyLeaveDecision({
      ...details,
      status: 'approved',
      reviewerName: 'HR Officer',
      note: 'Approved',
    })

    expect(result.success).toBe(true)
    expect(result.recipients).toEqual(['ann@example.test'])
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      recipient: expect.objectContaining({ email: 'ann@example.test' }),
      metadata: expect.objectContaining({ event: 'approved' }),
    }))
  })

  it('returns an actionable failure when the employee has no email', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      firstName: 'Ann',
      lastName: 'A',
      email: null,
      user: null,
    })
    const result = await notifyLeaveDecision({
      ...details,
      status: 'rejected',
      reviewerName: 'HR Officer',
    })
    expect(result).toMatchObject({ attempted: false, success: false, error: 'Employee email address is missing' })
    expect(mockSend).not.toHaveBeenCalled()
  })
})
