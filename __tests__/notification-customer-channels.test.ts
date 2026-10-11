import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/server-store', () => ({ loadAppState: vi.fn() }))
vi.mock('@/lib/accounting/integrity-suite', () => ({ runIntegritySuite: vi.fn() }))

import { customerRecipient } from '@/lib/notifications/operational-scanner'
import { configuredPhoneChannels } from '@/lib/notifications/channel-availability'

describe('customer notification channels', () => {
  it('uses email, plus WhatsApp/SMS only when they are set up', () => {
    expect(customerRecipient({ name: 'A', email: 'a@x.co', phone: '0700' }, [])).toEqual({ name: 'A', email: 'a@x.co', phone: '0700', channels: ['email'] })
    expect(customerRecipient({ name: 'A', email: 'a@x.co', phone: '0700' }, ['whatsapp'])?.channels).toEqual(['email', 'whatsapp'])
    expect(customerRecipient({ name: 'A', email: '', phone: '0700' }, ['sms'])?.channels).toEqual(['sms'])
    expect(customerRecipient({ name: 'A', email: '', phone: '0700' }, [])).toBeNull()
    expect(customerRecipient({ name: 'A', email: null, phone: null }, ['whatsapp', 'sms'])).toBeNull()
  })

  it('a paused SMS provider does not count as set up', () => {
    const env = { ...process.env }
    try {
      process.env.TELERIVET_API_KEY = 'k'
      process.env.TELERIVET_PROJECT_ID = 'p'
      delete process.env.WHATSAPP_PHONE_NUMBER_ID
      process.env.NOTIFICATIONS_PAUSE_SMS = 'true'
      expect(configuredPhoneChannels()).toEqual([])
      process.env.NOTIFICATIONS_PAUSE_SMS = 'false'
      expect(configuredPhoneChannels()).toEqual(['sms'])
    } finally {
      process.env = env
    }
  })
})
