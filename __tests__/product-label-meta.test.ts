import { describe, it, expect } from 'vitest'
import {
  formatConditionLabel,
  categoryConditionLine,
  truncateLabelText,
  resolveProductSpecs,
  normalizeProductType,
  resolveProductType,
} from '@/lib/product-label-meta'

describe('product-label-meta', () => {
  it('formats condition for labels', () => {
    expect(formatConditionLabel('new')).toBe('NEW')
    expect(formatConditionLabel('refurbished')).toBe('REFURB')
    expect(formatConditionLabel(undefined)).toBe('')
  })

  it('normalizes Inventory Condition to new or refurbished', () => {
    expect(normalizeProductType('new')).toBe('new')
    expect(normalizeProductType('NEW')).toBe('new')
    expect(normalizeProductType('refurbished')).toBe('refurbished')
    expect(normalizeProductType('')).toBe('refurbished')
    expect(resolveProductType('new', 'refurbished')).toBe('new')
    expect(resolveProductType(undefined, 'new')).toBe('new')
    expect(resolveProductType(null, undefined)).toBe('refurbished')
  })

  it('joins category and condition', () => {
    expect(categoryConditionLine('Laptops', 'refurbished')).toBe('Laptops · REFURB')
    expect(categoryConditionLine('Laptops', 'new')).toBe('Laptops · NEW')
    expect(categoryConditionLine('Accessories', null)).toBe('Accessories')
  })

  it('truncates long specs', () => {
    expect(truncateLabelText('8GB RAM, 256GB SSD', 40)).toBe('8GB RAM, 256GB SSD')
    expect(truncateLabelText('A'.repeat(80), 20).endsWith('…')).toBe(true)
    expect(truncateLabelText('A'.repeat(80), 20).length).toBe(20)
  })

  it('prefers specs over description', () => {
    expect(resolveProductSpecs({ specs: '16GB / 512GB', description: 'fallback' })).toBe('16GB / 512GB')
    expect(resolveProductSpecs({ description: 'Intel i5, 8GB' })).toBe('Intel i5, 8GB')
  })
})
