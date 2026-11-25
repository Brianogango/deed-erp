import { describe, it, expect } from 'vitest'
import { addWorkingDays, chequeClearsOn, clearingDaysSetting } from '@/lib/cheques/clearing'

describe('cheque clearing day', () => {
  it('2 working days, skipping weekends', () => {
    expect(chequeClearsOn('2026-11-23')).toBe('2026-11-25') // Mon → Wed
    expect(chequeClearsOn('2026-11-27')).toBe('2026-12-01') // Fri → Tue
    expect(chequeClearsOn('2026-11-28')).toBe('2026-12-01') // Sat → Tue
  })
  it('skips public holidays', () => {
    expect(chequeClearsOn('2026-12-11', 2, ['2026-12-12', '2026-12-14'])).toBe('2026-12-16') // Fri, Jamhuri Sat, holiday Mon
    expect(addWorkingDays('2026-12-24', 2, ['2026-12-25', '2026-12-26'])).toBe('2026-12-29')
  })
  it('setting: default 2, 0 allowed, nonsense ignored', () => {
    expect(clearingDaysSetting({})).toBe(2)
    expect(clearingDaysSetting({ chequeClearingDays: 0 })).toBe(0)
    expect(clearingDaysSetting({ chequeClearingDays: 'x' })).toBe(2)
    expect(chequeClearsOn('2026-11-23', 0)).toBe('2026-11-23')
  })
})
