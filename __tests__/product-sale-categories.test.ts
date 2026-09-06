import { describe, expect, it } from 'vitest'
import {
  ALL_CATEGORIES,
  PRODUCT_CREATION_CATEGORY_OPTIONS,
} from '@/lib/product-categories'
import {
  categoryDefaultTracking,
  isSerialOnlyCategory,
} from '@/lib/inventory-identifiers'

const requestedLabels = [
  'Sale - Laptops',
  'Sale - Accessories',
  'Sale - Desktops',
  'Sale - Complete Desktops',
  'Sale - Monitors',
  'Sale - Servers',
  'Sale - Power Backup Solutions',
  'Sale - Printers',
  'Sale - Software Licenses',
  'Sale - Parts and Components',
  'Sale - Printer Consumables',
  'Sale - Networking Equipment',
  'Sale - Consumer Electronics',
]

describe('product creation sale categories', () => {
  it('shows the requested labels in the requested order', () => {
    expect(PRODUCT_CREATION_CATEGORY_OPTIONS.map(option => option.label)).toEqual(requestedLabels)
  })

  it('maps every option to a unique supported internal category', () => {
    const values = PRODUCT_CREATION_CATEGORY_OPTIONS.map(option => option.value)
    expect(new Set(values).size).toBe(values.length)
    expect(values.every(value => ALL_CATEGORIES.includes(value))).toBe(true)
  })

  it('applies device tracking without forcing consumables to serial tracking', () => {
    for (const category of [
      'Complete Desktops',
      'Monitors',
      'Servers',
      'Power Backup Solutions',
      'Consumer Electronics',
    ]) {
      expect(isSerialOnlyCategory(category)).toBe(true)
      expect(categoryDefaultTracking(category)).toBe('SERIAL')
    }

    expect(isSerialOnlyCategory('Printer Consumables')).toBe(false)
    expect(categoryDefaultTracking('Printer Consumables')).toBe('QUANTITY')
  })
})
