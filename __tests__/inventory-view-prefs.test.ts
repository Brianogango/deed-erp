import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_PREFS,
  PRODUCT_LAYOUTS,
  compareCatalog,
  matchesCatalogShow,
  matchesCondition,
  normalizeViewPrefs,
} from '@/lib/inventory/view-prefs'

describe('inventory view prefs', () => {
  it('shows in-stock products by default and hides inactive or unsellable ones', () => {
    expect(matchesCatalogShow({}, 'in_stock', 1, true)).toBe(true)
    expect(matchesCatalogShow({}, 'in_stock', 0, true)).toBe(false)
    expect(matchesCatalogShow({ isActive: false }, 'all_sellable', 5, true)).toBe(false)
    expect(matchesCatalogShow({ canBeSold: false }, 'all_sellable', 5, true)).toBe(false)
  })

  it('out of stock excludes services and anything with stock', () => {
    expect(matchesCatalogShow({}, 'out_of_stock', 0, true)).toBe(true)
    expect(matchesCatalogShow({}, 'out_of_stock', 0, false)).toBe(false)
    expect(matchesCatalogShow({}, 'out_of_stock', 2, true)).toBe(false)
    expect(matchesCatalogShow({}, 'all_sellable', 0, false)).toBe(true)
  })

  it('treats anything not marked new as refurbished', () => {
    expect(matchesCondition({ productType: 'new' }, 'new')).toBe(true)
    expect(matchesCondition({ productType: 'new' }, 'refurbished')).toBe(false)
    expect(matchesCondition({}, 'refurbished')).toBe(true)
    expect(matchesCondition({}, 'all')).toBe(true)
  })

  it('sorts the catalog by price, stock and last update', () => {
    const rows = [
      { name: 'B', salePrice: 100, qty: 2, updatedAt: '2026-01-02' },
      { name: 'A', salePrice: 300, qty: 9, updatedAt: '' },
      { name: 'C', salePrice: 200, qty: 5, updatedAt: '2026-03-01' },
    ]
    const names = (sort: Parameters<typeof compareCatalog>[0]) => [...rows].sort(compareCatalog(sort)).map(r => r.name)
    expect(names('name')).toEqual(['A', 'B', 'C'])
    expect(names('price_asc')).toEqual(['B', 'C', 'A'])
    expect(names('price_desc')).toEqual(['A', 'C', 'B'])
    expect(names('stock_desc')).toEqual(['A', 'C', 'B'])
    expect(names('updated')).toEqual(['C', 'B', 'A'])
  })

  it('falls back to defaults for stale or unknown stored values', () => {
    expect(normalizeViewPrefs(null)).toEqual(DEFAULT_VIEW_PREFS)
    expect(normalizeViewPrefs({ catalogShow: 'nope', condition: 'new', productsLayout: 'pricing' })).toEqual({
      ...DEFAULT_VIEW_PREFS,
      condition: 'new',
    })
  })

  it('keeps prices out of the Product Master layouts', () => {
    const keys = PRODUCT_LAYOUTS.flatMap(l => l.columns)
    expect(keys).not.toContain('salePrice')
    expect(keys).not.toContain('cost')
  })
})
