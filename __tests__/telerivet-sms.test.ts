import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { resolveSmsProvider } from '@/lib/notifications/sms-provider'
import {
  mapTelerivetStatus,
  parseTelerivetWebhook,
  sendTelerivetSms,
  verifyTelerivetWebhookSecret,
} from '@/lib/integrations/telerivet'
import { summarizeEnv } from '@/lib/security/production-env'

const { mockApplyStatus } = vi.hoisted(() => ({
  mockApplyStatus: vi.fn(),
}))

vi.mock('@/lib/notifications/provider-status', () => ({
  applyProviderDeliveryStatus: mockApplyStatus,
}))

import { POST } from '@/app/api/webhooks/notifications/telerivet/route'

describe('resolveSmsProvider', () => {
  const keys = [
    'SMS_PROVIDER',
    'TELERIVET_API_KEY',
    'TELERIVET_PROJECT_ID',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
  ]

  beforeEach(() => {
    for (const key of keys) delete process.env[key]
  })

  it('prefers an explicit SMS_PROVIDER', () => {
    process.env.SMS_PROVIDER = 'telerivet'
    expect(resolveSmsProvider()).toBe('telerivet')
  })

  it('uses Telerivet when its API key and project are set', () => {
    process.env.TELERIVET_API_KEY = 'key'
    process.env.TELERIVET_PROJECT_ID = 'PJtest'
    expect(resolveSmsProvider()).toBe('telerivet')
  })

  it('falls back to Twilio when Telerivet is not configured', () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest'
    process.env.TWILIO_AUTH_TOKEN = 'token'
    process.env.TWILIO_PHONE_NUMBER = '+254700000000'
    expect(resolveSmsProvider()).toBe('twilio')
  })
})

describe('Telerivet helpers', () => {
  afterEach(() => {
    delete process.env.TELERIVET_WEBHOOK_SECRET
    delete process.env.TELERIVET_API_KEY
    delete process.env.TELERIVET_PROJECT_ID
    delete process.env.TELERIVET_PHONE_ID
    vi.unstubAllGlobals()
  })

  it('maps delivery statuses', () => {
    expect(mapTelerivetStatus('delivered')).toBe('delivered')
    expect(mapTelerivetStatus('sent')).toBe('sent')
    expect(mapTelerivetStatus('not_delivered')).toBe('failed')
  })

  it('verifies the webhook secret without leaking it', () => {
    process.env.TELERIVET_WEBHOOK_SECRET = 'shared-test-secret'
    expect(verifyTelerivetWebhookSecret('shared-test-secret')).toBe(true)
    expect(verifyTelerivetWebhookSecret('wrong')).toBe(false)
  })

  it('sends SMS through the Telerivet REST API', async () => {
    process.env.TELERIVET_API_KEY = 'tv-key'
    process.env.TELERIVET_PROJECT_ID = 'PJabc'
    process.env.TELERIVET_PHONE_ID = 'PNxyz'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'WV123', status: 'queued' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendTelerivetSms({ to: '+254712345678', message: 'Device ready' })
    expect(result).toEqual({ success: true, messageId: 'WV123', status: 'queued', httpStatus: 200 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telerivet.com/v1/projects/PJabc/messages/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          content: 'Device ready',
          to_number: '+254712345678',
          phone_id: 'PNxyz',
        }),
      }),
    )
    const auth = String((fetchMock.mock.calls[0][1] as RequestInit).headers?.['Authorization' as never] || (fetchMock.mock.calls[0][1] as any).headers.Authorization)
    expect(auth).toMatch(/^Basic /)
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain('tv-key')
  })

  it('hides Telerivet secrets from the Settings env summary', () => {
    const rows = summarizeEnv({
      TELERIVET_API_KEY: 'live-telerivet-key-do-not-leak',
      TELERIVET_WEBHOOK_SECRET: 'webhook-secret-do-not-leak',
      TELERIVET_PROJECT_ID: 'PJabc',
    })
    const dumped = JSON.stringify(rows)
    expect(dumped).not.toContain('live-telerivet-key-do-not-leak')
    expect(dumped).not.toContain('webhook-secret-do-not-leak')
    expect(rows.find(row => row.key === 'TELERIVET_PROJECT_ID')?.value).toBe('PJabc')
  })
})

describe('POST /api/webhooks/notifications/telerivet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TELERIVET_WEBHOOK_SECRET = 'shared-test-secret'
    mockApplyStatus.mockResolvedValue({ matched: true })
  })

  afterEach(() => {
    delete process.env.TELERIVET_WEBHOOK_SECRET
  })

  it('rejects a missing or wrong secret', async () => {
    const bad = await POST(new NextRequest('http://localhost/api/webhooks/notifications/telerivet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong', id: 'WV1', status: 'delivered' }),
    }))
    expect(bad.status).toBe(401)
    expect(mockApplyStatus).not.toHaveBeenCalled()
  })

  it('records a delivery status when the secret matches', async () => {
    const res = await POST(new NextRequest('http://localhost/api/webhooks/notifications/telerivet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: 'shared-test-secret',
        event: 'send_status',
        id: 'WV1',
        status: 'delivered',
      }),
    }))
    expect(res.status).toBe(200)
    expect(mockApplyStatus).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'telerivet',
      messageId: 'WV1',
      status: 'delivered',
    }))
  })
})

describe('Telerivet webhook parse', () => {
  it('accepts form-style fields', () => {
    expect(parseTelerivetWebhook({ secret: 'x', message_id: 'WV9', status: 'sent' })).toMatchObject({
      id: 'WV9',
      status: 'sent',
    })
  })
})
