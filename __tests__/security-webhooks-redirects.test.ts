import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  row: null as Record<string, any> | null,
  updateMany: vi.fn(),
  query: vi.fn(),
  applyStatus: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  default: {
    mpesaStkRequest: {
      findUnique: vi.fn(async () => (m.row ? { ...m.row } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        m.updateMany({ where, data })
        if (m.row && m.row.status === where.status) Object.assign(m.row, data)
        return { count: 1 }
      }),
    },
  },
}))
vi.mock('@/lib/mpesa/config', () => ({ loadMpesaConfig: () => ({ shortcode: '1', passkey: 'p' }) }))
vi.mock('@/lib/mpesa/daraja', () => ({ initiateStkPush: vi.fn(), queryStkPush: m.query }))
vi.mock('@/lib/notifications/provider-status', () => ({ applyProviderDeliveryStatus: m.applyStatus }))

import { applyStkCallback } from '@/lib/mpesa/service'
import { safeReturnTo } from '@/lib/auth/return-to'
import { clientIpFromHeaders } from '@/lib/client-ip'
import { POST as sesWebhook } from '@/app/api/webhooks/notifications/ses/route'

const callback = (o: Partial<{ merchant: string; code: number; amount: number; receipt: string }> = {}) => ({
  Body: { stkCallback: {
    MerchantRequestID: o.merchant ?? 'm-1', CheckoutRequestID: 'ws_CO_1', ResultCode: o.code ?? 0, ResultDesc: 'ok',
    CallbackMetadata: { Item: [{ Name: 'Amount', Value: o.amount ?? 1500 }, { Name: 'MpesaReceiptNumber', Value: o.receipt ?? 'RCP123' }] },
  } },
})

describe('M-Pesa STK callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.row = { checkoutRequestId: 'ws_CO_1', merchantRequestId: 'm-1', phone: '2547', amount: 1500, status: 'pending', resultCode: null, resultDesc: null, mpesaReceipt: null }
  })

  it('a forged success is not trusted: Daraja says still pending, so nothing settles', async () => {
    m.query.mockResolvedValue({ resultCode: '', resultDesc: 'processing' })
    const rec = await applyStkCallback(callback())
    expect(rec?.status).toBe('pending')
  })

  it('a callback with another merchant id or amount is ignored', async () => {
    m.query.mockResolvedValue({ resultCode: '0', resultDesc: 'paid' })
    await applyStkCallback(callback({ merchant: 'other' }))
    await applyStkCallback(callback({ amount: 1 }))
    expect(m.row?.status).toBe('pending')
    expect(m.query).not.toHaveBeenCalled()
  })

  it('settles once Daraja confirms, with the callback receipt; a settled request never changes', async () => {
    m.query.mockResolvedValue({ resultCode: '0', resultDesc: 'paid' })
    const rec = await applyStkCallback(callback())
    expect(rec).toMatchObject({ status: 'success', mpesaReceipt: 'RCP123' })
    await applyStkCallback(callback({ code: 1032 }))
    expect(m.row?.status).toBe('success')
  })
})

describe('login returnTo', () => {
  it('keeps same-site paths', () => {
    expect(safeReturnTo('/sales?tab=quotes')).toBe('/sales?tab=quotes')
    expect(safeReturnTo(encodeURIComponent('/finance/invoices#x'))).toBe('/finance/invoices#x')
  })
  it('refuses anything the browser would send to another site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/%5Cevil.example', 'https://evil.example', '/login?x=1', 'evil']) {
      expect(safeReturnTo(bad)).toBeNull()
    }
  })
})

describe('client IP for rate limits', () => {
  it('uses the hop nginx added, not what the client sent', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })
})

describe('SES SNS webhook', () => {
  it('refuses a topic that is not configured, before any signature work', async () => {
    vi.stubEnv('SES_SNS_TOPIC_ARNS', 'arn:aws:sns:eu-west-1:111111111111:deed-ses')
    const req = new NextRequest('http://x/api/webhooks/notifications/ses', {
      method: 'POST',
      body: JSON.stringify({ Type: 'Notification', Signature: 'x', SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-a.pem', TopicArn: 'arn:aws:sns:eu-west-1:999999999999:attacker', Message: '{}' }),
    })
    expect((await sesWebhook(req)).status).toBe(403)
    expect(m.applyStatus).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
