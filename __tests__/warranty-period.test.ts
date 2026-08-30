import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WARRANTY_MONTHS,
  addWarrantyMonths,
  formatWarrantyDuration,
  resolveWarrantyMonths,
} from '@/lib/warranty-period'

describe('resolveWarrantyMonths', () => {
  it('uses the product period when set', () => {
    expect(resolveWarrantyMonths(6)).toBe(6)
    expect(resolveWarrantyMonths(12)).toBe(12)
  })

  it('falls back to the company default, then 6 months', () => {
    expect(resolveWarrantyMonths(undefined, 6)).toBe(6)
    expect(resolveWarrantyMonths(0, 6)).toBe(6)
    expect(resolveWarrantyMonths(null)).toBe(DEFAULT_WARRANTY_MONTHS)
    expect(resolveWarrantyMonths('nope')).toBe(DEFAULT_WARRANTY_MONTHS)
  })
})

describe('addWarrantyMonths', () => {
  it('adds calendar months onto a date-only start', () => {
    expect(addWarrantyMonths('2026-08-05', 6)).toBe('2027-02-05')
    expect(addWarrantyMonths('2026-08-01', 6)).toBe('2027-02-01')
  })
})

describe('formatWarrantyDuration', () => {
  it('does not render a blank number as " months"', () => {
    expect(formatWarrantyDuration(6)).toBe('6 months')
    expect(formatWarrantyDuration(undefined)).toBe('—')
    expect(formatWarrantyDuration('')).toBe('—')
  })
})
