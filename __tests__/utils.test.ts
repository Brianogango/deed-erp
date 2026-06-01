import { describe, it, expect } from 'vitest'
import { uid, isUUID, now, seq, addDays } from '@/lib/utils'

describe('uid()', () => {
  it('returns a valid UUID', () => {
    expect(isUUID(uid())).toBe(true)
  })

  it('returns unique values across many calls', () => {
    const ids = new Set(Array.from({ length: 50 }, uid))
    expect(ids.size).toBe(50)
  })
})

describe('isUUID()', () => {
  it('accepts a valid UUID v4', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts all-zero UUID (utils uses a looser regex than legacy-compat)', () => {
    expect(isUUID('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('accepts uppercase UUID', () => {
    expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('rejects a 7-char base-36 string (old uid() output)', () => {
    expect(isUUID('a7f2k4m')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isUUID('')).toBe(false)
  })

  it('rejects null', () => {
    expect(isUUID(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isUUID(undefined)).toBe(false)
  })

  it('rejects number', () => {
    expect(isUUID(42)).toBe(false)
  })

  it('rejects UUID without dashes', () => {
    expect(isUUID('550e8400e29b41d4a716446655440000')).toBe(false)
  })

  it('rejects truncated UUID', () => {
    expect(isUUID('550e8400-e29b-41d4')).toBe(false)
  })

  it('rejects UUID with extra segment', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false)
  })
})

describe('now()', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("matches today's date", () => {
    expect(now()).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe('addDays()', () => {
  it('adds positive days', () => {
    expect(addDays('2026-01-01', 7)).toBe('2026-01-08')
  })

  it('adds zero days (unchanged)', () => {
    expect(addDays('2026-06-15', 0)).toBe('2026-06-15')
  })

  it('crosses month boundary', () => {
    expect(addDays('2026-01-28', 4)).toBe('2026-02-01')
  })

  it('crosses year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('subtracts days with negative n', () => {
    expect(addDays('2026-03-05', -4)).toBe('2026-03-01')
  })

  it('handles leap year Feb 28 + 1', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('seq()', () => {
  it('returns "prefix/NNNN" format', () => {
    expect(seq('INV')).toMatch(/^INV\/\d{4}$/)
  })

  it('zero-pads to exactly 4 digits', () => {
    const [, num] = seq('PO').split('/')
    expect(num).toHaveLength(4)
  })

  it('uses the provided prefix', () => {
    expect(seq('DEED')).toMatch(/^DEED\//)
  })
})
