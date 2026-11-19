import { describe, expect, it } from 'vitest'
import { textMatchesSearch } from '@/lib/text-search'

const invoice = ['INV/2026/0447', 'Kingsun International Limited', 'SO/2026/0310']

describe('list search matching', () => {
  it('ignores capitals', () => {
    expect(textMatchesSearch('kingsun', ...invoice)).toBe(true)
    expect(textMatchesSearch('KINGSUN INTERNATIONAL', ...invoice)).toBe(true)
  })

  it('takes the words in any order', () => {
    expect(textMatchesSearch('limited kingsun', ...invoice)).toBe(true)
    expect(textMatchesSearch('0447 kingsun', ...invoice)).toBe(true)
  })

  it('ignores separators in document numbers', () => {
    expect(textMatchesSearch('inv 0447', ...invoice)).toBe(true)
    expect(textMatchesSearch('inv-2026-0447', ...invoice)).toBe(true)
    expect(textMatchesSearch('inv20260447', ...invoice)).toBe(true)
    expect(textMatchesSearch('so/2026/0310', ...invoice)).toBe(true)
  })

  it('ignores stray spaces and an empty search', () => {
    expect(textMatchesSearch('  kingsun   0447 ', ...invoice)).toBe(true)
    expect(textMatchesSearch('   ', ...invoice)).toBe(true)
  })

  it('still needs every word to be there', () => {
    expect(textMatchesSearch('kingsun ncba', ...invoice)).toBe(false)
    expect(textMatchesSearch('0448', ...invoice)).toBe(false)
  })
})
