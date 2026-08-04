import { describe, it, expect } from 'vitest'
import {
  buildRepairTrackingWhatsAppMessage,
  buildWhatsAppShareUrl,
  resolveRepairWhatsAppRecipient,
  whatsappPhoneDigits,
} from '@/lib/whatsapp-share'

describe('whatsapp-share', () => {
  it('normalises Kenyan phone numbers for wa.me', () => {
    expect(whatsappPhoneDigits('0712 345 678')).toBe('254712345678')
    expect(whatsappPhoneDigits('+254712345678')).toBe('254712345678')
    expect(whatsappPhoneDigits('254712345678')).toBe('254712345678')
    expect(whatsappPhoneDigits('712345678')).toBe('254712345678')
    expect(whatsappPhoneDigits('')).toBeNull()
    expect(whatsappPhoneDigits('123')).toBeNull()
  })

  it('builds the tracking message with name and link', () => {
    const text = buildRepairTrackingWhatsAppMessage({
      clientName: 'Jane Doe',
      trackingUrl: 'https://erp.deed.co.ke/portal/repair/REP-1',
    })
    expect(text).toContain('Hello Jane Doe,')
    expect(text).toContain('https://erp.deed.co.ke/portal/repair/REP-1')
    expect(text).toContain('Thank you for choosing Deed Technologies.')
  })

  it('builds a wa.me share URL', () => {
    const url = buildWhatsAppShareUrl({
      phone: '0712345678',
      text: 'Hello',
    })
    expect(url).toBe('https://wa.me/254712345678?text=Hello')
  })

  it('prefers contact person on company repairs', () => {
    expect(
      resolveRepairWhatsAppRecipient({
        customerName: 'Acme Ltd',
        customerPhone: '020123456',
        contactPersonName: 'Jane Doe',
        contactPersonPhone: '0712345678',
      }),
    ).toEqual({ name: 'Jane Doe', phone: '0712345678' })

    expect(
      resolveRepairWhatsAppRecipient({
        customerName: 'John',
        customerPhone: '0711111111',
      }),
    ).toEqual({ name: 'John', phone: '0711111111' })

    expect(resolveRepairWhatsAppRecipient({ customerName: 'X' })).toBeNull()
  })
})
