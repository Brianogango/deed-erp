import { describe, expect, it } from 'vitest'
import { assertQuoteNotExpired } from '@/lib/sale-order-expiry'

describe('assertQuoteNotExpired', () => {
  it('allows missing validUntil', () => {
    expect(assertQuoteNotExpired(null).ok).toBe(true)
  })

  it('blocks past dates', () => {
    const res = assertQuoteNotExpired('2020-01-01')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/expired/i)
  })

  it('skips expiry when the quotation is a workshop repair', () => {
    expect(assertQuoteNotExpired('2020-01-01', { skip: true }).ok).toBe(true)
  })

  it('allows today and future dates', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(assertQuoteNotExpired(tomorrow.toISOString().slice(0, 10)).ok).toBe(true)
  })
})
