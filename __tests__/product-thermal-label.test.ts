import { describe, expect, it } from 'vitest'
import { productThermalSpecs } from '@/lib/product-label'

describe('productThermalSpecs', () => {
  it('maps computer specs into Processor, RAM and Storage fields', () => {
    const specs = productThermalSpecs({
      name: 'HP EliteBook 840 G8 Laptop',
      category: 'Laptops',
      specsText: '11th Gen Intel Core i5, 16GB RAM, 512GB NVMe SSD',
    })

    expect(specs.map(item => item.label)).toEqual(['Processor', 'RAM', 'Storage'])
    expect(specs[0].value).toContain('Intel Core i5')
    expect(specs[1].value).toBe('16GB')
    expect(specs[2].value).toContain('512GB')
  })

  it('uses one readable specification field for accessories', () => {
    const specs = productThermalSpecs({
      name: 'Black Laptop Sleeve Bag - Assorted Size',
      category: 'Accessories',
      specsText: 'Protective black laptop sleeve bag; size to be specified.',
    })

    expect(specs).toHaveLength(1)
    expect(specs[0].label).toBe('Specification')
    expect(specs[0].value).toContain('Protective black laptop sleeve bag')
  })
})
