import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockPrisma, mockPublish } = vi.hoisted(() => ({
  mockPrisma: { invoice: { findUnique: vi.fn() } },
  mockPublish: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: mockPublish }))

import { notifyCustomerPaymentReceived } from '@/lib/finance/payment-receipt-notify'

const KEYS = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'SMS_PROVIDER', 'TELERIVET_API_KEY', 'TELERIVET_PROJECT_ID', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER']
const saved: Record<string, string | undefined> = {}

const invoice = (client: Record<string, unknown>) => ({
  id: 'inv-1', invoiceNumber: 'INV/2026/0170', totalAmount: 10000, amountPaid: 4000,
  client: { name: 'ACME', ...client },
})
const input = { invoiceId: 'inv-1', paymentId: 'pay-1', amount: 4000 }
const channelsSent = () => mockPublish.mock.calls[0][0].channels

beforeEach(() => {
  vi.clearAllMocks()
  mockPublish.mockResolvedValue({ id: 'evt' })
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('payment receipt channels', () => {
  it('no WhatsApp/SMS provider configured → email only, even when a phone exists', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(invoice({ email: 'a@acme.co.ke', phone: '+254700000000' }))
    await expect(notifyCustomerPaymentReceived(input)).resolves.toEqual({ sent: true })
    expect(channelsSent()).toEqual(['email'])
  })

  it('phone-only client and no provider → nothing queued', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(invoice({ email: '', phone: '+254700000000' }))
    await expect(notifyCustomerPaymentReceived(input)).resolves.toEqual({ sent: false, skipped: 'no_deliverable_channel' })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('adds each phone channel once its provider keys are set', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(invoice({ email: 'a@acme.co.ke', phone: '+254700000000' }))
    process.env.TELERIVET_API_KEY = 'k'; process.env.TELERIVET_PROJECT_ID = 'p'
    await notifyCustomerPaymentReceived(input)
    expect(channelsSent()).toEqual(['email', 'sms'])

    mockPublish.mockClear()
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1'; process.env.WHATSAPP_ACCESS_TOKEN = 't'
    await notifyCustomerPaymentReceived(input)
    expect(channelsSent()).toEqual(['email', 'whatsapp', 'sms'])
  })
})
