import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail, on: () => {}, verify: async () => true, close: () => {} }) },
}))

const ENV_KEYS = ['NODE_ENV', 'EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'HR_EMAIL', 'HR_SMTP_USER', 'HR_SMTP_PASS', 'EMAIL_SEND_AS_STAFF'] as const
const prev: Record<string, string | undefined> = {}
const env = process.env as Record<string, string | undefined>

async function loadEmail() {
  vi.resetModules()
  return import('@/lib/integrations/email')
}

const leave = { to: 'manager@deed.co.ke', mailbox: 'hr' as const, subject: 'Leave approval required', html: '<p>x</p>', replyTo: 'jane@deed.co.ke', senderName: 'Jane Wanjiku', senderEmail: 'jane@deed.co.ke' }

describe('leave emails come from the applicant\'s work email (no staff password)', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) prev[key] = env[key]
    env.NODE_ENV = 'production'
    env.EMAIL_PROVIDER = 'smtp'
    env.SMTP_HOST = 'mail.deed.co.ke'
    env.SMTP_USER = 'info@deed.co.ke'
    env.SMTP_PASS = 'test-only'
    env.EMAIL_FROM = 'info@deed.co.ke'
    env.HR_EMAIL = 'hr@deed.co.ke'
    env.HR_SMTP_USER = 'hr@deed.co.ke'
    env.HR_SMTP_PASS = 'test-only'
    delete env.EMAIL_SEND_AS_STAFF
    sendMail.mockReset()
  })
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (prev[key] === undefined) delete env[key]
      else env[key] = prev[key]
    }
  })

  it('sends From the person, signed in (Sender) as hr@', async () => {
    sendMail.mockResolvedValue({ accepted: ['manager@deed.co.ke'], rejected: [], messageId: 'm1' })
    const { sendEmail } = await loadEmail()
    const result = await sendEmail(leave)
    expect(result.success).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = sendMail.mock.calls[0][0]
    expect(mail.from).toEqual({ name: 'Jane Wanjiku', address: 'jane@deed.co.ke' })
    expect(mail.sender).toBe('hr@deed.co.ke')
    expect(mail.replyTo).toBe('jane@deed.co.ke')
  })

  it('falls back to "Name (via Deed HR)" <hr@> when the server refuses, and remembers', async () => {
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error('sender not allowed'), { responseCode: 550, command: 'DATA', response: '550 sender not owned by user' }))
      .mockResolvedValue({ accepted: ['manager@deed.co.ke'], rejected: [], messageId: 'm2' })
    const { sendEmail } = await loadEmail()
    expect((await sendEmail(leave)).success).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(2)
    expect(sendMail.mock.calls[1][0].from).toEqual({ name: 'Jane Wanjiku (via Deed HR)', address: 'hr@deed.co.ke' })
    expect(sendMail.mock.calls[1][0].sender).toBeUndefined()
    // Next email skips the refused attempt.
    await sendEmail(leave)
    expect(sendMail).toHaveBeenCalledTimes(3)
    expect(sendMail.mock.calls[2][0].from).toEqual({ name: 'Jane Wanjiku (via Deed HR)', address: 'hr@deed.co.ke' })
  })

  it('does not retry for a bad recipient', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('no such user'), { responseCode: 550, command: 'RCPT TO', response: '550 No Such User Here' }))
    const { sendEmail } = await loadEmail()
    expect((await sendEmail(leave)).success).toBe(false)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('never uses an outside address as From', async () => {
    sendMail.mockResolvedValue({ accepted: ['manager@deed.co.ke'], rejected: [], messageId: 'm3' })
    const { sendEmail } = await loadEmail()
    await sendEmail({ ...leave, senderEmail: 'jane@gmail.com' })
    expect(sendMail.mock.calls[0][0].from).toEqual({ name: 'Jane Wanjiku (via Deed HR)', address: 'hr@deed.co.ke' })
  })

  it('EMAIL_SEND_AS_STAFF=false keeps the name only', async () => {
    env.EMAIL_SEND_AS_STAFF = 'false'
    sendMail.mockResolvedValue({ accepted: ['manager@deed.co.ke'], rejected: [], messageId: 'm4' })
    const { sendEmail } = await loadEmail()
    await sendEmail(leave)
    expect(sendMail.mock.calls[0][0].from).toEqual({ name: 'Jane Wanjiku (via Deed HR)', address: 'hr@deed.co.ke' })
  })
})
