import { describe, it, expect } from 'vitest'
import { canCreateProductFromSales, hasExactProduct, similarProducts } from '@/lib/sales/similar-products'

const products = [
  { id: '1', name: 'HP EliteBook 840 G5 i5 8GB 256GB', sku: 'HP-840G5' },
  { id: '2', name: 'HP EliteBook 840 G8 i5 16GB 512GB' },
  { id: '3', name: 'Dell Latitude 5420 i5' },
  { id: '4', name: 'HP ProBook 450 G9', isActive: false },
]

describe('quote product search', () => {
  it('suggests close matches when the exact search finds nothing', () => {
    expect(similarProducts(products, 'hp 840 g5 core i5').map(p => p.id)[0]).toBe('1')
    expect(similarProducts(products, 'elitebook 840').map(p => p.id)).toEqual(['1', '2'])
    expect(similarProducts(products, 'latitude')).toHaveLength(1)
    expect(similarProducts(products, 'probook 450')).toEqual([]) // archived
    expect(similarProducts(products, 'macbook air')).toEqual([])
  })
  it('knows an exact name, and who may create products', () => {
    expect(hasExactProduct(products, '  dell latitude 5420  I5 ')).toBe(true)
    expect(hasExactProduct(products, 'Dell Latitude 5420')).toBe(false)
    expect(canCreateProductFromSales('inventory_officer')).toBe(true)
    expect(canCreateProductFromSales('sales_rep')).toBe(false)
  })
})
