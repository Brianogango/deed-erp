import { describe, expect, it } from 'vitest'
import { modelOfProductName, specDifferences, variantName } from '@/lib/refurbishment/variant'

describe('refurb variants', () => {
  it('finds spec differences known on both sides', () => {
    const d = specDifferences('Intel Core i5 8th Gen, 16GB RAM, 512GB SSD', 'Hp Elitebook 840 G5 - 8th Gen, Intel Core i5, 8GB RAM, 256GB SSD')
    expect(d.map(x => x.label)).toEqual(['RAM', 'Storage'])
    expect(d[0]).toEqual({ label: 'RAM', machine: '16GB', product: '8GB' })
  })

  it('says nothing when the specs match or one side is unknown', () => {
    expect(specDifferences('i5 8th Gen 8GB RAM 256GB SSD', 'Elitebook 840 G5 - 8th Gen, Intel Core i5, 8GB RAM, 256GB SSD')).toEqual([])
    expect(specDifferences('', 'anything 8GB RAM')).toEqual([])
    expect(specDifferences('16GB RAM', 'HP EliteBook 840 G5')).toEqual([])
  })

  it('names the variant model + specs', () => {
    expect(modelOfProductName('HP EliteBook 840 G1 - Intel Core i5 4th Gen - 4GB RAM 500GB')).toBe('HP EliteBook 840 G1')
    expect(modelOfProductName('HP EliteBook 840 G6 i5 16GB/512GB #15')).toBe('HP EliteBook 840 G6')
    expect(modelOfProductName('Hp Elitebook 840 G5 - 8th Gen, Intel Core i5, 8GB RAM')).toBe('Hp Elitebook 840 G5')
    expect(modelOfProductName('Lenovo ThinkPad T14s Gen 4 i7')).toBe('Lenovo ThinkPad T14s Gen 4')
    expect(modelOfProductName('Dell Latitude 5490')).toBe('Dell Latitude 5490')
    expect(variantName('HP EliteBook 840 G1 - Intel Core i5 4th Gen - 4GB RAM', ' i5 4th Gen, 8GB RAM, 256GB SSD ')).toBe('HP EliteBook 840 G1 - i5 4th Gen, 8GB RAM, 256GB SSD')
    expect(variantName('Dell Latitude 5490', '')).toBe('Dell Latitude 5490')
  })
})
