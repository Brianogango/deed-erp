import { describe, expect, it } from 'vitest'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { compactLabelSpecs } from '@/lib/inventory/machine-label'

describe('RAM is never read as the drive', () => {
  it('"8GB RAM 256GB SSD" is 8GB of RAM and a 256GB drive', () => {
    for (const s of ['Intel Core i5 6th Gen - 8GB RAM 256GB SSD', 'i5 6th Gen 8GB RAM 256 GB SSD', '16GB DDR4 512GB NVMe SSD']) {
      const p = parseSpecsString(s)
      expect(p.primaryStorageGb).not.toBe(p.totalRamGb)
    }
    expect(parseSpecsString('8GB RAM 256GB SSD')).toMatchObject({ totalRamGb: 8, primaryStorageGb: 256 })
    expect(parseSpecsString('16GB DDR4 512GB NVMe SSD')).toMatchObject({ totalRamGb: 16, primaryStorageGb: 512 })
  })
  it('still reads drive words between the size and the type', () => {
    expect(parseSpecsString('8GB RAM, 512GB M.2 NVMe SSD').primaryStorageGb).toBe(512)
    expect(parseSpecsString('1TB Samsung SSD, 16GB RAM').primaryStorageGb).toBe(1024)
  })
  it('the label trusts the specs over a saved configuration that took the RAM for the drive', () => {
    expect(compactLabelSpecs('Intel Core i5 6th Gen - 8GB RAM 256GB SSD', { processorGeneration: '6th Gen', processor: 'Intel Core i5', totalRamGb: 8, primaryStorageGb: 8 }))
      .toBe('6th i5 8GB 256GB')
    // The unit's specs come first; the saved configuration fills what they omit.
    expect(compactLabelSpecs('Intel Core i5 6th Gen - 8GB RAM', { totalRamGb: 8, primaryStorageGb: 512 })).toBe('6th i5 8GB 512GB')
  })
})

describe('the label when the saved drive is wrong and the unit specs say nothing of it', () => {
  const badConfig = { processorGeneration: '6th Gen', processor: 'Intel Core i5', totalRamGb: 8, primaryStorageGb: 8 }
  it('takes the drive from the product name (LT000075)', () => {
    expect(compactLabelSpecs('Intel Core i5 6th Gen, 8GB RAM', badConfig, 'HP Elitebook 820 G3 - Intel Core i5 (6th Gen) - 8GB RAM -  256GB SSD - 12.5"'))
      .toBe('6th i5 8GB 256GB')
    expect(compactLabelSpecs('', badConfig, 'HP Elitebook 820 G3 - Intel Core i5 (6th Gen) - 8GB RAM -  256GB SSD - 12.5"'))
      .toBe('6th i5 8GB 256GB')
  })
  it('leaves the drive out rather than print the RAM twice', () => {
    expect(compactLabelSpecs('Intel Core i5 6th Gen, 8GB RAM', badConfig, 'HP Elitebook 820 G3')).toBe('6th i5 8GB')
  })
})

describe('a machine whose specs were changed after its configuration was saved', () => {
  it('prints the RAM from the unit specs, not the older configuration (16GB → 8GB)', () => {
    expect(compactLabelSpecs('Intel Core i5 8th Gen, 8GB RAM, 256GB SSD', { processorGeneration: '8th Gen', processor: 'Intel Core i5', totalRamGb: 16, primaryStorageGb: 256 }))
      .toBe('8th i5 8GB 256GB')
  })
})
