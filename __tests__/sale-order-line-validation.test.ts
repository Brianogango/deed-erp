import { describe, it, expect } from 'vitest'
import { validateSaleOrderLines } from '@/lib/sale-order-line-validation'

describe('validateSaleOrderLines', () => {
  it('allows empty or section-only lines', () => {
    expect(validateSaleOrderLines([])).toBeNull()
    expect(validateSaleOrderLines([{ lineType: 'section', productName: 'Bundle' }])).toBeNull()
    expect(validateSaleOrderLines(null)).toBeNull()
  })

  it('rejects non-positive qty and negative price', () => {
    expect(validateSaleOrderLines([{ productName: 'SSD', qty: 0, unitPrice: 100 }])).toMatch(/greater than zero/i)
    expect(validateSaleOrderLines([{ productName: 'SSD', qty: -1, unitPrice: 100 }])).toMatch(/greater than zero/i)
    expect(validateSaleOrderLines([{ productName: 'SSD', qty: 1, unitPrice: -5 }])).toMatch(/cannot be negative/i)
  })

  it('rejects out-of-range discount', () => {
    expect(validateSaleOrderLines([{ productName: 'SSD', qty: 1, unitPrice: 10, discount: 120 }])).toMatch(/Discount/i)
    expect(validateSaleOrderLines([{ productName: 'SSD', qty: 1, unitPrice: 10, discountPercent: -1 }])).toMatch(/Discount/i)
  })

  it('accepts a valid commercial line', () => {
    expect(validateSaleOrderLines([{ productName: 'SSD', qty: 2, unitPrice: 1500, discount: 10 }])).toBeNull()
  })
})
