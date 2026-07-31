import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSendEmail, mockPrisma } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockPrisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/integrations/email', () => ({ sendEmail: mockSendEmail }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import {
  configuredLeaveInboxEmails,
  notifyLeaveApplied,
  notifyLeaveDecision,
  resolveApplicantEmail,
  resolveHrApproverEmails,
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
    process.env.LEAVE_NOTIFY_EMAILS = 'edwin@deed.co.ke'
    delete process.env.LEAVE_NOTIFY_EMAIL
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm1' })
    mockPrisma.user.findMany.mockResolvedValue([
      { email: 'brian@deed.co.ke' },
      { email: 'edwin@deed.co.ke' },
      { email: 'invalid' },
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

  it('dedupes configured inbox + LEAVE_NOTIFY_EMAILS', () => {
    expect(configuredLeaveInboxEmails()).toEqual(['hr@deed.co.ke', 'edwin@deed.co.ke'])
  })

  it('resolves HR recipients from inbox + active director/admin_officer users', async () => {
    const emails = await resolveHrApproverEmails()
    expect(emails).toContain('hr@deed.co.ke')
    expect(emails).toContain('edwin@deed.co.ke')
    expect(emails).toContain('brian@deed.co.ke')
    expect(emails).not.toContain('invalid')
  })

  it('uses the employee HR-record email for the applicant', async () => {
    const result = await resolveApplicantEmail('emp-1')
    expect(result.email).toBe('ann.personal@example.com')
    expect(result.name).toBe('Ann Applicant')
  })

  it('emails HR when leave is applied (does not throw on mail failure)', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' })
    await expect(notifyLeaveApplied(sample)).resolves.toBeUndefined()
    expect(mockSendEmail).toHaveBeenCalled()
    const args = mockSendEmail.mock.calls[0][0]
    expect(args.mailbox).toBe('hr')
    expect(args.subject).toContain('LV/0042')
    expect(String(args.to)).toContain('hr@deed.co.ke')
  })

  it('emails the applicant on approve using HR employee email', async () => {
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
    expect(mockSendEmail.mock.calls[0][0].text).toContain('Enjoy')
  })

  it('emails the applicant on decline', async () => {
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
