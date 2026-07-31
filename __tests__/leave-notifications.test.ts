import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSendEmail, mockPrisma } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockPrisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/integrations/email', () => ({ sendEmail: mockSendEmail }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import {
  DEFAULT_LEAVE_APPLY_CC,
  leaveApplyToEmail,
  notifyLeaveApplied,
  notifyLeaveDecision,
  resolveApplicantEmail,
  resolveLeaveApplyCcEmails,
} from '@/lib/hr/leave-notifications'

const sample = {
  id: 'lr-1',
  ref: 'LV/0042',
  employeeId: 'emp-1',
  employeeName: 'Ann Applicant',
  leaveType: 'annual',
  startDate: '2026-08-03',
  endDate: '2026-08-07',
  days: 5,
  reason: 'Family visit',
  status: 'pending_hr',
}

describe('leave-notifications', () => {
  const prevEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.HR_TEAM_EMAIL = 'hr@deed.co.ke'
    delete process.env.LEAVE_APPLY_CC_EMAILS
    delete process.env.LEAVE_NOTIFY_EMAILS
    delete process.env.LEAVE_NOTIFY_EMAIL
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm1' })
    mockPrisma.employee.findMany.mockResolvedValue([
      { firstName: 'Edwin', email: 'edwin@deed.co.ke', user: null },
      { firstName: 'Dennis', email: 'dennis@deed.co.ke', user: { email: 'dennis.user@deed.co.ke' } },
    ])
    mockPrisma.employee.findUnique.mockResolvedValue({
      firstName: 'Ann',
      lastName: 'Applicant',
      email: 'ann.personal@example.com',
    })
  })

  afterEach(() => {
    process.env = { ...prevEnv }
  })

  it('applies To hr@deed.co.ke', () => {
    expect(leaveApplyToEmail()).toBe('hr@deed.co.ke')
  })

  it('resolves Edwin and Dennis CC from HR employee records', async () => {
    await expect(resolveLeaveApplyCcEmails()).resolves.toEqual([
      'edwin@deed.co.ke',
      'dennis@deed.co.ke',
    ])
  })

  it('uses LEAVE_APPLY_CC_EMAILS when set', async () => {
    process.env.LEAVE_APPLY_CC_EMAILS = 'edwin@deed.co.ke, dennis@deed.co.ke'
    await expect(resolveLeaveApplyCcEmails()).resolves.toEqual([
      'edwin@deed.co.ke',
      'dennis@deed.co.ke',
    ])
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled()
  })

  it('falls back to default CC emails when DB has none', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([])
    await expect(resolveLeaveApplyCcEmails()).resolves.toEqual([...DEFAULT_LEAVE_APPLY_CC])
  })

  it('uses the employee HR-record email for the applicant', async () => {
    const result = await resolveApplicantEmail('emp-1')
    expect(result.email).toBe('ann.personal@example.com')
    expect(result.name).toBe('Ann Applicant')
  })

  it('emails hr@deed.co.ke To with Edwin+Dennis CC on apply', async () => {
    await notifyLeaveApplied(sample)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'hr@deed.co.ke',
      cc: ['edwin@deed.co.ke', 'dennis@deed.co.ke'],
      mailbox: 'hr',
      subject: expect.stringContaining('LV/0042'),
    }))
  })

  it('does not throw when apply mail fails', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' })
    await expect(notifyLeaveApplied(sample)).resolves.toBeUndefined()
  })

  it('emails the applier only on approve (no CC)', async () => {
    await notifyLeaveDecision({
      ...sample,
      status: 'approved',
      reviewerName: 'Edwin',
      reviewNotes: 'Enjoy',
    }, 'approved')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ann.personal@example.com',
      mailbox: 'hr',
      subject: 'Leave LV/0042 approved',
    }))
    expect(mockSendEmail.mock.calls[0][0].cc).toBeUndefined()
    expect(mockSendEmail.mock.calls[0][0].text).toContain('Enjoy')
  })

  it('emails the applier only on decline', async () => {
    await notifyLeaveDecision({
      ...sample,
      status: 'rejected',
      reviewerName: 'HR',
      reviewNotes: 'Insufficient cover',
    }, 'rejected')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ann.personal@example.com',
      subject: 'Leave LV/0042 declined',
    }))
    expect(mockSendEmail.mock.calls[0][0].cc).toBeUndefined()
  })

  it('skips applicant email when HR record has no email', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      firstName: 'No',
      lastName: 'Mail',
      email: null,
    })
    await notifyLeaveDecision(sample, 'approved')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
