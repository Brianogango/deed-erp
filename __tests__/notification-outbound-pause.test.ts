import { afterEach, describe, expect, it } from 'vitest'
import { isBlockedEventChannel, isEmailSmsPaused, isOverdueInvoiceEmailPaused, isPausedOutboundChannel } from '@/lib/notifications/outbound-pause'

describe('notification outbound pause', () => {
  const previous = process.env.NOTIFICATIONS_PAUSE_EMAIL_SMS

  afterEach(() => {
    if (previous === undefined) delete process.env.NOTIFICATIONS_PAUSE_EMAIL_SMS
    else process.env.NOTIFICATIONS_PAUSE_EMAIL_SMS = previous
  })

  it('pauses email and SMS by default', () => {
    delete process.env.NOTIFICATIONS_PAUSE_EMAIL_SMS
    expect(isEmailSmsPaused()).toBe(true)
    expect(isPausedOutboundChannel('email')).toBe(true)
    expect(isPausedOutboundChannel('sms')).toBe(true)
    expect(isPausedOutboundChannel('in_app')).toBe(false)
    expect(isPausedOutboundChannel('push')).toBe(false)
    expect(isPausedOutboundChannel('whatsapp')).toBe(false)
  })

  it('resumes only when explicitly set false', () => {
    expect(isEmailSmsPaused({ NOTIFICATIONS_PAUSE_EMAIL_SMS: 'false' })).toBe(false)
    expect(isPausedOutboundChannel('email', { NOTIFICATIONS_PAUSE_EMAIL_SMS: 'false' })).toBe(false)
    expect(isPausedOutboundChannel('sms', { NOTIFICATIONS_PAUSE_EMAIL_SMS: '0' })).toBe(false)
    expect(isEmailSmsPaused({ NOTIFICATIONS_PAUSE_EMAIL_SMS: 'true' })).toBe(true)
  })

  it('email and SMS can be switched separately', () => {
    const emailOn = { NOTIFICATIONS_PAUSE_EMAIL: 'false' }
    expect(isPausedOutboundChannel('email', emailOn)).toBe(false)
    expect(isPausedOutboundChannel('sms', emailOn)).toBe(true)
    expect(isPausedOutboundChannel('sms', { NOTIFICATIONS_PAUSE_EMAIL_SMS: 'false', NOTIFICATIONS_PAUSE_SMS: 'true' })).toBe(true)
    expect(isPausedOutboundChannel('email', { NOTIFICATIONS_PAUSE_EMAIL_SMS: 'false', NOTIFICATIONS_PAUSE_SMS: 'true' })).toBe(false)
    expect(isEmailSmsPaused(emailOn)).toBe(false)
  })
})

describe('event-level email blocks', () => {
  it('never emails low stock', () => {
    expect(isBlockedEventChannel('inventory.low_stock', 'email', {})).toBe(true)
    expect(isBlockedEventChannel('inventory.low_stock', 'in_app', {})).toBe(false)
  })

  it('pauses overdue-invoice email by default and resumes on false', () => {
    expect(isOverdueInvoiceEmailPaused({})).toBe(true)
    expect(isBlockedEventChannel('finance.invoice_overdue', 'email', {})).toBe(true)
    const resumed = { NOTIFICATIONS_PAUSE_OVERDUE_INVOICES: 'false' }
    expect(isOverdueInvoiceEmailPaused(resumed)).toBe(false)
    expect(isBlockedEventChannel('finance.invoice_overdue', 'email', resumed)).toBe(false)
    expect(isBlockedEventChannel('finance.invoice_overdue', 'in_app', {})).toBe(false)
  })

  it('leaves other events alone', () => {
    expect(isBlockedEventChannel('director.daily_brief', 'email', {})).toBe(false)
  })
})
