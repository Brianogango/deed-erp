import { describe, expect, it } from 'vitest'
import {
  combineLocalDateAndTime,
  ensureRepairIntakeTimestamp,
  formatIntakeDateTime,
  localDateTimeParts,
  pad2,
} from '@/lib/repair-datetime'

describe('repair-datetime', () => {
  it('pad2 left-pads single digits', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2(12)).toBe('12')
  })

  it('localDateTimeParts returns YYYY-MM-DD and HH:mm', () => {
    const d = new Date(2026, 7, 10, 14, 5, 30) // Aug 10 2026 14:05 local
    const parts = localDateTimeParts(d)
    expect(parts.date).toBe('2026-08-10')
    expect(parts.time).toBe('14:05')
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

  it('ensureRepairIntakeTimestamp upgrades date-only to now', () => {
    const now = new Date('2026-08-10T15:30:00.000Z')
    expect(ensureRepairIntakeTimestamp('2026-08-10', now)).toBe(now.toISOString())
    expect(ensureRepairIntakeTimestamp('', now)).toBe(now.toISOString())
    expect(ensureRepairIntakeTimestamp(undefined, now)).toBe(now.toISOString())
  })

  it('formatIntakeDateTime keeps date-only strings date-only', () => {
    const out = formatIntakeDateTime('2026-08-10')
    expect(out).not.toMatch(/\d{2}:\d{2}/)
    expect(out).toMatch(/2026|Aug|08|10/)
  })

  it('formatIntakeDateTime shows time for ISO datetimes', () => {
    const out = formatIntakeDateTime('2026-08-10T13:47:24.003Z')
    expect(out).toMatch(/\d{2}:\d{2}/)
  })

  it('formatIntakeDateTime returns em dash for empty', () => {
    expect(formatIntakeDateTime('')).toBe('—')
    expect(formatIntakeDateTime(null)).toBe('—')
    expect(formatIntakeDateTime(undefined)).toBe('—')
  })
})
