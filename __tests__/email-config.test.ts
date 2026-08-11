import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { resolveEmailProvider, getEmailConfigStatus, generateRfqEmail, pickMailbox } from '@/lib/integrations/email'

describe('resolveEmailProvider', () => {
  const prevProvider = process.env.EMAIL_PROVIDER
  const prevHost = process.env.SMTP_HOST
  afterEach(() => {
    process.env.EMAIL_PROVIDER = prevProvider
    process.env.SMTP_HOST = prevHost
  })

  it('uses explicit EMAIL_PROVIDER', () => {
    process.env.EMAIL_PROVIDER = 'ses'
    process.env.SMTP_HOST = 'mail.example.com'
    expect(resolveEmailProvider()).toBe('ses')
  })

  it('auto-selects smtp when only SMTP_HOST is set', () => {
    delete process.env.EMAIL_PROVIDER
    process.env.SMTP_HOST = 'mail.deed.co.ke'
    expect(resolveEmailProvider()).toBe('smtp')
  })
})

describe('getEmailConfigStatus', () => {
  const prevProvider = process.env.EMAIL_PROVIDER
  const prevHost = process.env.SMTP_HOST
  const prevUser = process.env.SMTP_USER
  const prevPass = process.env.SMTP_PASS
  const prevFrom = process.env.EMAIL_FROM
  afterEach(() => {
    process.env.EMAIL_PROVIDER = prevProvider
    process.env.SMTP_HOST = prevHost
    process.env.SMTP_USER = prevUser
    process.env.SMTP_PASS = prevPass
    process.env.EMAIL_FROM = prevFrom
  })

  it('reports missing SMTP_PASS', () => {
    process.env.EMAIL_PROVIDER = 'smtp'
    process.env.SMTP_HOST = 'mail.deed.co.ke'
    process.env.SMTP_USER = 'info@deed.co.ke'
    delete process.env.SMTP_PASS
    process.env.EMAIL_FROM = 'info@deed.co.ke'
    const status = getEmailConfigStatus()
    expect(status.missing).toContain('SMTP_PASS')
    expect(status.provider).toBe('smtp')
  })
})

describe('pickMailbox department From/Reply-To', () => {
  const keys = [
    'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM',
    'SALES_EMAIL', 'SALES_SMTP_USER', 'SALES_SMTP_PASS',
    'ACCOUNTS_EMAIL', 'ACCOUNTS_SMTP_USER', 'ACCOUNTS_SMTP_PASS',
    'HR_EMAIL', 'HR_SMTP_USER', 'HR_SMTP_PASS',
  ] as const
  const prev: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const key of keys) prev[key] = process.env[key]
  })
  afterEach(() => {
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  })

  it('sends From and Reply-To as sales@ and authenticates as sales@', () => {
    process.env.SMTP_USER = 'hello@deed.co.ke'
    process.env.SMTP_PASS = 'secret'
    process.env.EMAIL_FROM = 'hello@deed.co.ke'
    process.env.SALES_EMAIL = 'sales@deed.co.ke'
    delete process.env.SALES_SMTP_USER
    delete process.env.SALES_SMTP_PASS
    const sales = pickMailbox('sales')
    expect(sales.from).toBe('sales@deed.co.ke')
    expect(sales.replyTo).toBe('sales@deed.co.ke')
    expect(sales.user).toBe('sales@deed.co.ke')
    expect(sales.pass).toBe('secret')
  })

  it('uses dedicated accounts SMTP credentials when set', () => {
    process.env.SMTP_USER = 'hello@deed.co.ke'
    process.env.SMTP_PASS = 'secret'
    process.env.EMAIL_FROM = 'hello@deed.co.ke'
    process.env.ACCOUNTS_EMAIL = 'accounts@deed.co.ke'
    process.env.ACCOUNTS_SMTP_USER = 'accounts@deed.co.ke'
    process.env.ACCOUNTS_SMTP_PASS = 'accounts-secret'
    const accounts = pickMailbox('accounts')
    expect(accounts.from).toBe('accounts@deed.co.ke')
    expect(accounts.replyTo).toBe('accounts@deed.co.ke')
    expect(accounts.dedicatedAuth).toBe(true)
    expect(accounts.user).toBe('accounts@deed.co.ke')
    expect(accounts.pass).toBe('accounts-secret')
  })

  it('falls back to default SMTP for hr when HR_SMTP_* is unset', () => {
    process.env.SMTP_USER = 'hello@deed.co.ke'
    process.env.SMTP_PASS = 'secret'
    process.env.EMAIL_FROM = 'hello@deed.co.ke'
    process.env.HR_EMAIL = 'hr@deed.co.ke'
    delete process.env.HR_SMTP_USER
    delete process.env.HR_SMTP_PASS
    const hr = pickMailbox('hr')
    expect(hr.from).toBe('hello@deed.co.ke')
    expect(hr.replyTo).toBe('hr@deed.co.ke')
    expect(hr.user).toBe('hello@deed.co.ke')
    expect(hr.pass).toBe('secret')
    expect(hr.dedicatedAuth).toBe(false)
  })

  it('falls back to default SMTP for accounts when ACCOUNTS_SMTP_* is unset', () => {
    process.env.SMTP_USER = 'hello@deed.co.ke'
    process.env.SMTP_PASS = 'secret'
    process.env.EMAIL_FROM = 'hello@deed.co.ke'
    process.env.ACCOUNTS_EMAIL = 'accounts@deed.co.ke'
    delete process.env.ACCOUNTS_SMTP_USER
    delete process.env.ACCOUNTS_SMTP_PASS
    const accounts = pickMailbox('accounts')
    expect(accounts.from).toBe('hello@deed.co.ke')
    expect(accounts.replyTo).toBe('accounts@deed.co.ke')
    expect(accounts.user).toBe('hello@deed.co.ke')
    expect(accounts.dedicatedAuth).toBe(false)
  })

  it('uses dedicated HR SMTP credentials when set', () => {
    process.env.SMTP_USER = 'hello@deed.co.ke'
    process.env.SMTP_PASS = 'secret'
    process.env.EMAIL_FROM = 'hello@deed.co.ke'
    process.env.HR_EMAIL = 'hr@deed.co.ke'
    process.env.HR_SMTP_USER = 'hr@deed.co.ke'
    process.env.HR_SMTP_PASS = 'hr-secret'
    const hr = pickMailbox('hr')
    expect(hr.from).toBe('hr@deed.co.ke')
    expect(hr.replyTo).toBe('hr@deed.co.ke')
    expect(hr.dedicatedAuth).toBe(true)
    expect(hr.user).toBe('hr@deed.co.ke')
    expect(hr.pass).toBe('hr-secret')
  })
})

describe('generateRfqEmail', () => {
  it('includes vendor and line totals', () => {
    const mail = generateRfqEmail({
      ref: 'RFQ-1',
      vendorName: 'Acme Supplies',
      companyName: 'Deed',
      lines: [{ productName: 'Laptop', qty: 2, unitPrice: 1000, subtotal: 2000 }],
      subtotal: 2000,
      taxTotal: 320,
      total: 2320,
    })
    expect(mail.subject).toContain('RFQ-1')
    expect(mail.html).toContain('Acme Supplies')
    expect(mail.html).toContain('Laptop')
    expect(mail.text).toContain('2,320')
  })
})
