import { describe, it, expect, beforeAll } from 'vitest'

// Built-in results captured before the cache is installed.
const DATES = [new Date('2026-10-05T07:30:15Z'), new Date('2025-01-31T23:59:59Z'), new Date(0), new Date('invalid')]
const DATE_OPTIONS: Array<Intl.DateTimeFormatOptions | undefined> = [
  undefined,
  {},
  { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' },
  { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
  { hour: '2-digit', minute: '2-digit' },
  { weekday: 'long' },
  { month: 'long', year: 'numeric' },
  { dateStyle: 'medium' },
  { timeZone: 'UTC' },
]
const LOCALES = [undefined, 'en-KE', 'en-GB', 'en-US']
const NUMBERS = [0, 1234567.891, -42.5, 0.005, NaN, Infinity]
const NUMBER_OPTIONS: Array<Intl.NumberFormatOptions | undefined> = [
  undefined, {}, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, { style: 'currency', currency: 'KES' }, { maximumFractionDigits: 0 },
]

const capture = () => {
  const out: string[] = []
  for (const l of LOCALES) {
    for (const o of DATE_OPTIONS) {
      for (const d of DATES) {
        for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
          try { out.push(d[m](l, o)) } catch (e) { out.push(`throws ${(e as Error).name}`) }
        }
      }
    }
    for (const o of NUMBER_OPTIONS) for (const n of NUMBERS) out.push(n.toLocaleString(l, o))
  }
  return out
}

let builtIn: string[]
beforeAll(() => { builtIn = capture() })

describe('installIntlFormatCache', () => {
  it('formats exactly like the built-ins', async () => {
    const { installIntlFormatCache } = await import('@/lib/intl-cache')
    installIntlFormatCache()
    expect(capture()).toEqual(builtIn)
  })

  it('formats Kenyan dates and amounts', async () => {
    const { formatKeDate, formatKe2dp } = await import('@/lib/intl-cache')
    expect(formatKeDate('2026-10-05T21:30:00Z')).toBe(new Date('2026-10-05T21:30:00Z').toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' }))
    expect(formatKeDate('not a date')).toBe('not a date')
    expect(formatKe2dp(1234.5)).toBe('1,234.50')
  })
})
