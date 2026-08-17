import { describe, it, expect } from 'vitest'
import {
  REPAIR_DATE_MIN,
  REPAIR_DATE_MAX_YEARS_AHEAD,
  repairDateMaxIso,
  repairDateBoundsError,
  repairDatesWriteError,
  assertFiniteSequenceNext,
  isCorruptDocRef,
  toDateOnly,
} from '@/lib/data-validation'

describe('assertFiniteSequenceNext (P1-DATA-001)', () => {
  it('accepts a finite positive integer', () => {
    expect(assertFiniteSequenceNext(1)).toBe(1)
    expect(assertFiniteSequenceNext(42, 'RFD sequence')).toBe(42)
  })

  it('rejects NaN (the RFD/0NaN root cause)', () => {
    expect(() => assertFiniteSequenceNext(NaN, 'RFD sequence')).toThrow(/finite positive integer/)
    expect(() => assertFiniteSequenceNext(Number('bad') + 1)).toThrow()
  })

  it('rejects Infinity, zero, negatives, and non-integers', () => {
    expect(() => assertFiniteSequenceNext(Infinity)).toThrow()
    expect(() => assertFiniteSequenceNext(0)).toThrow()
    expect(() => assertFiniteSequenceNext(-3)).toThrow()
    expect(() => assertFiniteSequenceNext(1.5)).toThrow()
  })
})

describe('isCorruptDocRef', () => {
  it('flags NaN refs', () => {
    expect(isCorruptDocRef('RFD/0NaN')).toBe(true)
    expect(isCorruptDocRef('JRN/RFD/0NaN')).toBe(true)
  })

  it('allows normal refs', () => {
    expect(isCorruptDocRef('RFD/0007')).toBe(false)
    expect(isCorruptDocRef('REP-352227')).toBe(false)
  })
})

describe('repair date bounds (P1-DATA-001)', () => {
  const now = new Date('2026-08-06T12:00:00.000Z')
  const max = repairDateMaxIso(now)

  it(`uses min ${REPAIR_DATE_MIN} and today + ${REPAIR_DATE_MAX_YEARS_AHEAD}y`, () => {
    expect(max).toBe('2028-08-06')
  })

  it('accepts dates inside bounds', () => {
    expect(repairDateBoundsError('2020-01-15', 'intakeDate', now)).toBeNull()
    expect(repairDateBoundsError('2026-08-06', 'intakeDate', now)).toBeNull()
    expect(repairDateBoundsError(max, 'intakeDate', now)).toBeNull()
  })

  it('rejects dates before 2015-01-01', () => {
    const err = repairDateBoundsError('2014-12-31', 'intakeDate', now)
    expect(err).toMatch(/on or after 2015-01-01/)
  })

  it('rejects dates more than 2 years in the future (e.g. 2091)', () => {
    const err = repairDateBoundsError('2091-04-28', 'date', now)
    expect(err).toMatch(/on or before 2028-08-06/)
  })

  it('rejects unparseable dates when provided', () => {
    expect(repairDateBoundsError('not-a-date', 'intakeDate', now)).toMatch(/not a valid date/)
  })

  it('allows missing dates (requiredness is caller concern)', () => {
    expect(repairDateBoundsError(undefined, 'intakeDate', now)).toBeNull()
    expect(repairDateBoundsError('', 'intakeDate', now)).toBeNull()
  })

  it('repairDatesWriteError checks intakeDate and legacy date', () => {
    expect(repairDatesWriteError({ intakeDate: '2026-01-01', date: '2026-01-02' }, now)).toBeNull()
    expect(repairDatesWriteError({ intakeDate: '2091-04-28' }, now)).toMatch(/intakeDate/)
    expect(repairDatesWriteError({ date: '2010-01-01' }, now)).toMatch(/^date /)
  })

  it('grandfathers an existing out-of-range intake date on unrelated updates', () => {
    const previous = { intakeDate: '2091-04-28', date: '2091-04-28' }
    expect(repairDatesWriteError({ intakeDate: '2091-04-28', date: '2091-04-28' }, now, previous)).toBeNull()
    expect(repairDatesWriteError({ intakeDate: '2092-04-28', date: '2091-04-28' }, now, previous)).toMatch(/intakeDate/)
  })

  it('toDateOnly normalizes ISO timestamps', () => {
    expect(toDateOnly('2026-08-06T15:30:00.000Z')).toBe('2026-08-06')
    expect(toDateOnly('bogus')).toBeNull()
  })
})

describe('seq NaN simulation', () => {
  it('undefined/NaN counter + 1 is rejected before ref formatting', () => {
    const current = Number(undefined) // NaN — same as missing makeC key / bad localStorage
    expect(() => assertFiniteSequenceNext(current + 1, 'RFD sequence')).toThrow()
    // Demonstrates the historical "0NaN" formatting path is no longer reachable
    // once the guard runs first:
    const broken = `${'RFD'}/${String(NaN).padStart(4, '0')}`
    expect(broken).toBe('RFD/0NaN')
    expect(isCorruptDocRef(broken)).toBe(true)
  })
})
