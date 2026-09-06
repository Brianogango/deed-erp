import { describe, expect, it } from 'vitest'
import {
  ALL_CATEGORIES,
  PRODUCT_CREATION_CATEGORY_OPTIONS,
  defaultProductCreationCategory,
  inventoryCategoryFilterOptions,
  normalizeProductCategorySettings,
  resolveProductCreationCategoryOptions,
} from '@/lib/product-categories'
import { categoryDefaults } from '@/lib/product-accounts'
import {
  categoryDefaultTracking,
  isSerialOnlyCategory,
} from '@/lib/inventory-identifiers'
import {
  DEFAULT_PRICING_MARGIN_POLICY,
  resolvePricingCategoryId,
} from '@/lib/pricing/margin-policy'

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
  it('supports settings-managed labels and visibility without changing internal identifiers', () => {
    const configured = normalizeProductCategorySettings([
      { value: 'Laptops', label: 'Sale - Notebook Computers', enabled: true },
      { value: 'Accessories', label: 'Sale - Accessories', enabled: false },
      { value: 'Not a real category', label: 'Unsafe', enabled: true },
    ])

    expect(resolveProductCreationCategoryOptions(configured)).toContainEqual({
      value: 'Laptops',
      label: 'Sale - Notebook Computers',
    })
    expect(resolveProductCreationCategoryOptions(configured).some(option => option.value === 'Accessories')).toBe(false)
    expect(resolveProductCreationCategoryOptions(configured).some(option => option.label === 'Unsafe')).toBe(false)
  })

  it('accepts administrator-created categories only through protected custom identifiers', () => {
    const options = resolveProductCreationCategoryOptions([
      { value: 'custom:projectors', label: 'Sale - Projectors', enabled: true },
      { value: 'Projectors', label: 'Unsafe direct mapping', enabled: true },
    ])

    expect(options).toEqual([
      { value: 'custom:projectors', label: 'Sale - Projectors' },
    ])
  })

  it('maps each new category to the correct pricing band', () => {
    const expected = {
      'Complete Desktops': 'refurb_desktops',
      Monitors: 'monitors',
      Servers: 'servers',
      'Power Backup Solutions': 'power_backup',
      'Printer Consumables': 'printer_consumables',
      'Consumer Electronics': 'consumer_electronics',
    }

    for (const [erpCategory, pricingCategoryId] of Object.entries(expected)) {
      expect(resolvePricingCategoryId({
        policy: DEFAULT_PRICING_MARGIN_POLICY,
        erpCategory,
      })).toBe(pricingCategoryId)
    }

    expect(resolvePricingCategoryId({
      policy: DEFAULT_PRICING_MARGIN_POLICY,
      erpCategory: 'Complete Desktops',
      productType: 'new',
    })).toBe('brand_new_pcs')
  })

  it('maps new sale categories to their official CoA sale and purchase codes', () => {
    expect(categoryDefaults('Complete Desktops')).toMatchObject({ saleAccountCode: '5004', costAccountCode: '6104' })
    expect(categoryDefaults('Monitors')).toMatchObject({ saleAccountCode: '5005', costAccountCode: '6105' })
    expect(categoryDefaults('Servers')).toMatchObject({ saleAccountCode: '5006', costAccountCode: '6106' })
    expect(categoryDefaults('Power Backup Solutions')).toMatchObject({ saleAccountCode: '5007', costAccountCode: '6107' })
    expect(categoryDefaults('Printer Consumables')).toMatchObject({
      productKind: 'consumable',
      saleAccountCode: '5011',
      costAccountCode: '6111',
    })
    expect(categoryDefaults('Consumer Electronics')).toMatchObject({ saleAccountCode: '5013', costAccountCode: '6113' })
  })

  it('defaults new products to the first enabled category, not a hidden Laptops row', () => {
    expect(defaultProductCreationCategory([
      { value: 'Laptops', label: 'Sale - Laptops', enabled: false },
      { value: 'Monitors', label: 'Sale - Monitors', enabled: true },
    ])).toBe('Monitors')
  })

  it('keeps custom categories visible in inventory filters', () => {
    const options = inventoryCategoryFilterOptions([
      { value: 'custom:projectors', label: 'Sale - Projectors', enabled: true },
    ])
    expect(options).toContainEqual({ value: 'custom:projectors', label: 'Sale - Projectors' })
    expect(options.some(option => option.value === 'Laptops')).toBe(true)
  })
})
