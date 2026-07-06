import { describe, it, expect } from 'vitest'
import { normalizePhone, phoneMatches, maskPhone } from '@/lib/portal-verify'

describe('normalizePhone', () => {
  it('reduces to the last 9 digits regardless of prefix/format', () => {
    expect(normalizePhone('0712345678')).toBe('712345678')
    expect(normalizePhone('+254712345678')).toBe('712345678')
    expect(normalizePhone('0712 345 678')).toBe('712345678')
  })
})

describe('phoneMatches', () => {
  it('matches the same number across common Kenyan formats', () => {
    expect(phoneMatches('+254712345678', '0712345678')).toBe(true)
    expect(phoneMatches('0712 345 678', '254712345678')).toBe(true)
  })

  it('rejects a different number', () => {
    expect(phoneMatches('0712345678', '0787654321')).toBe(false)
  })

  it('rejects empty / too-short input so it cannot be bypassed with blanks', () => {
    expect(phoneMatches('', '0712345678')).toBe(false)
    expect(phoneMatches('123', '0712345678')).toBe(false)
    expect(phoneMatches(undefined, undefined)).toBe(false)
  })
})

describe('maskPhone', () => {
  it('masks the middle digits, keeping head and tail', () => {
    expect(maskPhone('0712345678')).toBe('07******78')
  })

  it('returns empty for empty input', () => {
    expect(maskPhone('')).toBe('')
    expect(maskPhone(null)).toBe('')
  })
})
