import { afterEach, describe, expect, it } from 'vitest'
import { isEmailSmsPaused, isPausedOutboundChannel } from '@/lib/notifications/outbound-pause'

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
})
