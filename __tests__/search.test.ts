import { describe, expect, it } from 'vitest'
import { matchesSearchTerms, normalizeSearchValue, tokenizeSearchQuery } from '@/lib/search'

describe('shared ERP search', () => {
  it('matches business references regardless of punctuation', () => {
    expect(matchesSearchTerms('INV20260084', ['INV/2026/0084'])).toBe(true)
    expect(matchesSearchTerms('PO 2026 83', ['PO/2026/0083'])).toBe(true)
  })

  it('supports multi-field AND searches', () => {
    expect(matchesSearchTerms('rose x1', ['Rosemary Nzuu', 'Lenovo ThinkPad X1 Carbon'])).toBe(true)
    expect(matchesSearchTerms('rose hp', ['Rosemary Nzuu', 'Lenovo ThinkPad X1 Carbon'])).toBe(false)
  })

  it('normalizes case, accents, phone punctuation, arrays, and numbers', () => {
    expect(normalizeSearchValue('ÉliteBook 840-G8')).toContain('elitebook 840 g8')
    expect(matchesSearchTerms('0710274692', ['0710 274 692'])).toBe(true)
    expect(matchesSearchTerms('845 g7', [['HP EliteBook', '845 G7'], 2])).toBe(true)
  })

  it('does not emit empty query tokens', () => {
    expect(tokenizeSearchQuery('  INV/001   John ')).toEqual(['inv001', 'john'])
    expect(matchesSearchTerms('   ', ['anything'])).toBe(true)
  })
})
