import { describe, expect, it } from 'vitest'
import { isStandInProduct } from '@/lib/refurbishment/unidentified'

describe('stand-in products', () => {
  it('knows the unidentified placeholders and products with no sale price', () => {
    expect(isStandInProduct({ name: 'Laptop — unidentified', salePrice: 5000 })).toBe(true)
    expect(isStandInProduct({ name: 'lenovo tm', salePrice: 0 })).toBe(true)
    expect(isStandInProduct({ name: 'lenovo tm' })).toBe(true)
    expect(isStandInProduct({ name: 'Lenovo ThinkPad T480 i5 8GB 256GB', salePrice: 32000 })).toBe(false)
  })
  it('falls back to the name on the job when the product is not loaded', () => {
    expect(isStandInProduct(null, 'Laptop — unidentified')).toBe(true)
    expect(isStandInProduct(undefined, 'HP 840 G6')).toBe(false)
  })
})

import { standInProductName } from '@/lib/refurbishment/unidentified'

describe('stand-in names typed at intake', () => {
  it('becomes "<name> — unidentified", tidied, once', () => {
    expect(standInProductName('lenovo tm')).toBe('lenovo tm — unidentified')
    expect(standInProductName('  lenovo   tm ')).toBe('lenovo tm — unidentified')
    expect(standInProductName('lenovo tm — unidentified')).toBe('lenovo tm — unidentified')
    expect(standInProductName('x')).toBe('')
    expect(isStandInProduct({ name: standInProductName('hp dead'), salePrice: 0 })).toBe(true)
  })
})
