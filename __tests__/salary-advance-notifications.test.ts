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
  notifySalaryAdvanceApplied,
  notifySalaryAdvanceDecision,
  notifySalaryAdvanceDisbursed,
  toSalaryAdvanceNotifyPayload,
} from '@/lib/hr/salary-advance-notifications'

const sample = {
  id: 'adv-1',
  ref: 'ADV/0007',
  employeeId: 'emp-1',
  employeeName: 'Ann Applicant',
  amount: 15000,
  paymentTerms: 'payroll_deduction',
  repaymentMonths: 3,
  repaymentStartPeriod: '2026-09',
  monthlyDeduction: 5000,
  reason: 'School fees',
  status: 'pending',
  neededByDate: '2026-08-20',
}

describe('salary-advance-notifications', () => {
  const prevEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.HR_TEAM_EMAIL = 'hr@deed.co.ke'
    delete process.env.LEAVE_APPLY_CC_EMAILS
    delete process.env.LEAVE_NOTIFY_EMAILS
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

  it('emails hr@deed.co.ke To with Edwin+Dennis CC on apply', async () => {
    await notifySalaryAdvanceApplied(sample)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'hr@deed.co.ke',
      cc: ['edwin@deed.co.ke', 'dennis@deed.co.ke'],
      mailbox: 'hr',
      subject: expect.stringContaining('ADV/0007'),
    }))
    expect(mockSendEmail.mock.calls[0][0].text).toContain('KES 15,000')
  })

  it('does not throw when apply mail fails', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' })
    await expect(notifySalaryAdvanceApplied(sample)).resolves.toBeUndefined()
  })

  it('emails the applicant only on approve (no CC)', async () => {
    await notifySalaryAdvanceDecision({
      ...sample,
      status: 'approved',
      reviewerName: 'Edwin',
      decisionNote: 'Approved — disburse this week',
    }, 'approved')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ann.personal@example.com',
      mailbox: 'hr',
      subject: 'Salary advance ADV/0007 approved',
    }))
    expect(mockSendEmail.mock.calls[0][0].cc).toBeUndefined()
    expect(mockSendEmail.mock.calls[0][0].text).toContain('Approved — disburse this week')
  })

  it('emails the applicant only on reject', async () => {
    await notifySalaryAdvanceDecision({
      ...sample,
      status: 'rejected',
      reviewerName: 'HR',
      decisionNote: 'Outstanding balance too high',
    }, 'rejected')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ann.personal@example.com',
      subject: 'Salary advance ADV/0007 rejected',
    }))
  })

  it('emails the applicant when disbursed', async () => {
    await notifySalaryAdvanceDisbursed({
      ...sample,
      status: 'paid',
      paidDate: '2026-08-12',
    })
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ann.personal@example.com',
      subject: 'Salary advance ADV/0007 disbursed',
    }))
    expect(mockSendEmail.mock.calls[0][0].text).toContain('disbursed')
  })

  it('skips applicant email when HR record has no email', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      firstName: 'No',
      lastName: 'Mail',
      email: null,
    })
    await notifySalaryAdvanceDecision(sample, 'approved')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('maps prisma rows into notify payloads', () => {
    const payload = toSalaryAdvanceNotifyPayload({
      id: 'adv-9',
      reference: 'ADV/0009',
      employeeId: 'emp-9',
      employeeName: 'Brian',
      amount: '20000',
      paymentTerms: 'manual_repayment',
      repaymentMonths: 2,
      repaymentStartPeriod: '2026-10',
      monthlyDeduction: '10000',
      reason: 'Medical',
      status: 'pending',
      neededByDate: new Date('2026-08-15T00:00:00.000Z'),
    })
    expect(payload).toMatchObject({
      ref: 'ADV/0009',
      amount: 20000,
      monthlyDeduction: 10000,
      neededByDate: '2026-08-15',
    })
  })
})
