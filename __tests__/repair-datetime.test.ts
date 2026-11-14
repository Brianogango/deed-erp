import { describe, expect, it } from 'vitest'
import { combineLocalDateAndTime, ensureRepairIntakeTimestamp, pad2 } from '@/lib/repair-datetime'

describe('repair-datetime', () => {
  it('pad2 left-pads single digits', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2(12)).toBe('12')
  })

  
  it('combineLocalDateAndTime builds a local ISO timestamp', () => {
    const iso = combineLocalDateAndTime('2026-08-10', '13:47')
    const d = new Date(iso)
    expect(Number.isNaN(d.getTime())).toBe(false)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(10)
    expect(d.getHours()).toBe(13)
    expect(d.getMinutes()).toBe(47)
  })

  it('ensureRepairIntakeTimestamp keeps full ISO datetimes', () => {
    const iso = '2026-08-10T13:47:24.003Z'
    expect(ensureRepairIntakeTimestamp(iso)).toBe(new Date(iso).toISOString())
  })

  it('ensureRepairIntakeTimestamp keeps date-only calendar days instead of stamping now', () => {
    const now = new Date('2026-08-10T15:30:00.000Z')
    const iso = ensureRepairIntakeTimestamp('2026-04-28', now)
    const d = new Date(iso)
    expect(Number.isNaN(d.getTime())).toBe(false)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3)
    expect(d.getDate()).toBe(28)
    expect(ensureRepairIntakeTimestamp('', now)).toBe(now.toISOString())
    expect(ensureRepairIntakeTimestamp(undefined, now)).toBe(now.toISOString())
  })

  
  
  })
