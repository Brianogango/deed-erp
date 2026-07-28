import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEmailProvider, validateEmailConfig } from '@/lib/integrations/email-config'
import { sendEmail } from '@/lib/integrations/email'

const original = { ...process.env }

afterEach(() => {
  vi.unstubAllEnvs()
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key]
  }
  Object.assign(process.env, original)
})

describe('email configuration', () => {
  it('defaults to SMTP to match production deployment configuration', () => {
    delete process.env.EMAIL_PROVIDER
    expect(resolveEmailProvider()).toBe('smtp')
  })

  it('reports actionable missing SMTP settings and rejects placeholders', () => {
    process.env.EMAIL_PROVIDER = 'smtp'
    process.env.EMAIL_FROM = 'noreply@deed.co.ke'
    process.env.SMTP_HOST = 'mail.deed.co.ke'
    process.env.SMTP_USER = 'info@deed.co.ke'
    process.env.SMTP_PASS = 'REPLACE_WITH_YOUR_PASSWORD'
    const result = validateEmailConfig()
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('SMTP_PASS is not configured')
  })

  it('accepts a complete SendGrid configuration', () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    process.env.EMAIL_FROM = 'noreply@deed.co.ke'
    process.env.SENDGRID_API_KEY = 'SG.real-key'
    expect(validateEmailConfig()).toEqual({ ok: true, provider: 'sendgrid', errors: [] })
  })

  it('fails before provider I/O when production configuration is incomplete', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.EMAIL_PROVIDER = 'smtp'
    process.env.EMAIL_FROM = 'noreply@deed.co.ke'
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS
    const result = await sendEmail({
      to: 'employee@example.test',
      subject: 'Test',
      html: '<p>Test</p>',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('SMTP_HOST is not configured')
  })
})
