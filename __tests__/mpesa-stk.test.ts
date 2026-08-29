import { describe, expect, it } from 'vitest'
import { parseStkCallback, stkStatusFromResultCode } from '@/lib/mpesa/callback'
import { mpesaConfigured } from '@/lib/mpesa/config'
import { darajaStkPassword, darajaTimestamp } from '@/lib/mpesa/password'
import { normalizeMpesaPhone } from '@/lib/mpesa/phone'

describe('M-Pesa phone normalization', () => {
  it('accepts 07, 2547 and +2547 forms', () => {
    expect(normalizeMpesaPhone('0708374149')).toBe('254708374149')
    expect(normalizeMpesaPhone('254708374149')).toBe('254708374149')
    expect(normalizeMpesaPhone('+254 708 374 149')).toBe('254708374149')
    expect(normalizeMpesaPhone('708374149')).toBe('254708374149')
  })

  it('rejects landlines and short numbers', () => {
    expect(normalizeMpesaPhone('0202210000')).toBeNull()
    expect(normalizeMpesaPhone('123')).toBeNull()
    expect(normalizeMpesaPhone('')).toBeNull()
  })
})

describe('Daraja STK password', () => {
  it('matches Base64(shortcode + passkey + timestamp)', () => {
    const timestamp = '20260829215255'
    const password = darajaStkPassword('174379', 'bfb279f9a9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919', timestamp)
    expect(password).toBe(
      Buffer.from(`174379bfb279f9a9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919${timestamp}`, 'utf8').toString('base64'),
    )
  })

  it('formats Nairobi timestamps as YYYYMMDDHHmmss', () => {
    const ts = darajaTimestamp(new Date('2026-08-29T18:52:55Z'))
    expect(ts).toMatch(/^\d{14}$/)
  })
})

describe('STK callback parse', () => {
  it('reads a successful Express callback', () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'c520-4832-84bf-a8e41a82a93234809',
          CheckoutRequestID: 'ws_CO_290820262153003708374149',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 1 },
              { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
              { Name: 'PhoneNumber', Value: 254708374149 },
            ],
          },
        },
      },
    })
    expect(parsed).toMatchObject({
      merchantRequestId: 'c520-4832-84bf-a8e41a82a93234809',
      checkoutRequestId: 'ws_CO_290820262153003708374149',
      resultCode: 0,
      mpesaReceipt: 'NLJ7RT61SV',
      amount: 1,
    })
    expect(stkStatusFromResultCode(0)).toBe('success')
    expect(stkStatusFromResultCode(1032)).toBe('cancelled')
    expect(stkStatusFromResultCode(1)).toBe('failed')
  })

  it('returns null for unrelated payloads', () => {
    expect(parseStkCallback({ hello: true })).toBeNull()
  })
})

describe('Daraja config gate', () => {
  it('is not configured without keys', () => {
    expect(mpesaConfigured({
      consumerKey: '',
      consumerSecret: 'x',
      shortcode: '174379',
      passkey: 'x',
      callbackUrl: 'https://example.com/api/mpesa/callback',
    })).toBe(false)
  })
})
