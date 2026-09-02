import { describe, expect, it } from 'vitest'
import {
  searchPickerExactMatch,
  searchPickerItemText,
  searchPickerMatches,
} from '@/lib/search-picker-match'

const stand = { id: 'p1', name: 'Generic Adjustable Laptop Stand', sku: 'ACC-STAND', barcode: '123' }
const other = { id: 'p2', name: 'Generic USB-C Hub', sku: 'ACC-HUB' }

describe('searchPickerMatches', () => {
  it('matches name, sku, and barcode without serializing the whole row', () => {
    expect(searchPickerMatches(stand, 'adjustable laptop')).toBe(true)
    expect(searchPickerMatches(stand, 'ACC-STAND')).toBe(true)
    expect(searchPickerMatches(stand, '123')).toBe(true)
    expect(searchPickerMatches(stand, 'hub')).toBe(false)
    expect(searchPickerMatches(stand, '  ')).toBe(true)
  })

  it('does not throw when a row cannot be JSON.stringified', () => {
    const circular: Record<string, unknown> = { id: 'p3', name: 'Loop' }
    circular.self = circular
    expect(() => JSON.stringify(circular)).toThrow()
    expect(searchPickerMatches(circular, 'loop')).toBe(true)
    expect(searchPickerItemText(circular)).toContain('Loop')
  })
})

describe('searchPickerExactMatch', () => {
  it('selects a unique full name so Submit can enable without a dropdown click', () => {
    expect(searchPickerExactMatch([stand, other], 'Generic Adjustable Laptop Stand')?.id).toBe('p1')
    expect(searchPickerExactMatch([stand, other], 'acc-stand')?.id).toBe('p1')
    expect(searchPickerExactMatch([stand, other], 'Generic')).toBeNull()
  })
})
