import { describe, expect, it } from 'vitest'
import { matchesSearch, normalizeSearchText, searchIncludes } from '@/lib/search-utils'

describe('ERP search normalization', () => {
  it('is case and accent insensitive', () => {
    expect(matchesSearch('jose', 'José Ndegwa')).toBe(true)
    expect(matchesSearch('ELITEBOOK', 'HP EliteBook 840 G8')).toBe(true)
  })

  it('is tolerant of punctuation in document refs and serials', () => {
    expect(matchesSearch('INV 2026 0084', 'INV/2026/0084')).toBe(true)
    expect(matchesSearch('PF3 2ABC', 'PF3-2ABC')).toBe(true)
    expect(searchIncludes('0710-274-692', '0710 274')).toBe(true)
  })

  it('supports multi-token queries across separate searchable fields', () => {
    expect(matchesSearch('kijabe overdue', 'AIC Kijabe Hospital', 'INV/2026/0042', 'Overdue')).toBe(true)
    expect(matchesSearch('kijabe paid', 'AIC Kijabe Hospital', 'Overdue')).toBe(false)
  })

  it('normalizes repeated whitespace and symbols', () => {
    expect(normalizeSearchText('  HP   EliteBook / 840-G8 ')).toBe('hp elitebook 840 g8')
  })

  it('treats an empty query as a match', () => {
    expect(matchesSearch('', 'Anything')).toBe(true)
  })
})
