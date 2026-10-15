import { describe, expect, it } from 'vitest'
import { moneyInputValue } from '@/lib/intl-cache'

describe('moneyInputValue', () => {
  it('removes floating-point noise', () => {
    expect(moneyInputValue(0.1 + 0.2)).toBe('0.3')
    expect(moneyInputValue(1234.5600000000002)).toBe('1234.56')
    expect(moneyInputValue(93148 - 0.0000000001)).toBe('93148')
  })
  it('keeps whole and cent amounts exactly', () => {
    expect(moneyInputValue(1000)).toBe('1000')
    expect(moneyInputValue(45000.5)).toBe('45000.5')
    expect(moneyInputValue(12345678901.5)).toBe('12345678901.5')
  })
  it('rounds to cents', () => {
    expect(moneyInputValue(1.005)).toBe('1.01')
    expect(moneyInputValue(2.675)).toBe('2.68')
  })
  it('handles negatives, zero and bad input', () => {
    expect(moneyInputValue(-42.5)).toBe('-42.5')
    expect(moneyInputValue(-0)).toBe('0')
    expect(moneyInputValue(null)).toBe('0')
    expect(moneyInputValue(undefined)).toBe('0')
    expect(moneyInputValue(NaN)).toBe('0')
    expect(moneyInputValue('1,234.50')).toBe('1234.5')
  })
})
