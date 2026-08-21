import { describe, expect, it } from 'vitest'
import { applyRefurbPartsToUnitName, refurbishmentSellingNamePatch } from '@/lib/refurbishment/apply-upgrade-specs'

const ram8 = {
  id: 'ram-8',
  name: '8GB DDR3L SODIMM Laptop RAM - 1600MHz',
  category: 'Parts & Components',
}
const ssd256 = {
  id: 'ssd-256',
  name: '256GB SATA SSD - 2.5-inch SATA III',
  category: 'Parts & Components',
}

describe('refurbishment unit selling name', () => {
  it('adds an 8GB stick onto existing 4GB and keeps/replaces 256GB SSD for the client-facing name', () => {
    const result = applyRefurbPartsToUnitName({
      productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD',
      specs: 'i5, 4GB RAM, 256GB SSD',
      parts: [
        { partName: ram8.name, productId: ram8.id, status: 'used', qty: 1 },
        { partName: ssd256.name, productId: ssd256.id, status: 'used', qty: 1 },
      ],
      products: [ram8, ssd256],
    })
    expect(result).not.toBeNull()
    expect(result?.ramGb).toBe(12)
    expect(result?.storageGb).toBe(256)
    expect(result?.sellingName).toMatch(/12GB RAM/)
    expect(result?.sellingName).toMatch(/256GB SSD/)
    expect(result?.sellingName).toMatch(/EliteBook 840 G5/)
    expect(result?.sellingName).not.toMatch(/4GB RAM/)
  })

  it('parses SODIMM / SATA part titles without a linked catalog product', () => {
    const result = applyRefurbPartsToUnitName({
      productName: 'Lenovo ThinkPad T14',
      specs: '10th Gen Intel Core i5, 4GB RAM, 500GB HDD',
      parts: [
        { partName: '8GB DDR3L SODIMM Laptop RAM - 1600MHz', status: 'allocated' },
        { partName: '256GB SATA SSD - 2.5-inch SATA III', status: 'used' },
      ],
    })
    expect(result?.ramGb).toBe(12)
    expect(result?.storageGb).toBe(256)
    expect(result?.sellingName).toMatch(/12GB RAM/)
    expect(result?.sellingName).toMatch(/256GB SSD/)
    expect(result?.sellingName).not.toMatch(/HDD/)
  })

  it('swaps RAM when the tech pulls the old stick (4GB → 8GB)', () => {
    const result = applyRefurbPartsToUnitName({
      productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD',
      specs: 'i5, 4GB RAM, 256GB SSD',
      parts: [{ partName: ram8.name, productId: ram8.id, status: 'used', installAction: 'swap' }],
      products: [ram8],
    })
    expect(result?.ramGb).toBe(8)
    expect(result?.sellingName).toMatch(/8GB RAM/)
    expect(result?.sellingName).not.toMatch(/12GB RAM/)
    expect(result?.sellingName).not.toMatch(/4GB RAM/)
  })

  it('adds a second SSD when installAction is add (256 + 256 → 512)', () => {
    const result = applyRefurbPartsToUnitName({
      productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD',
      specs: 'i5, 4GB RAM, 256GB SSD',
      parts: [{ partName: ssd256.name, productId: ssd256.id, status: 'used', installAction: 'add' }],
      products: [ssd256],
    })
    expect(result?.storageGb).toBe(512)
    expect(result?.sellingName).toMatch(/512GB SSD/)
  })

  it('does not rewrite the name for a battery or keyboard', () => {
    expect(
      applyRefurbPartsToUnitName({
        productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD',
        specs: '4GB RAM, 256GB SSD',
        parts: [{ partName: 'HP 840 G5 battery', status: 'used' }],
      }),
    ).toBeNull()
  })

  it('skips parts that are still on order', () => {
    expect(
      applyRefurbPartsToUnitName({
        productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD',
        specs: '4GB RAM, 256GB SSD',
        parts: [{ partName: ram8.name, productId: ram8.id, status: 'ordered' }],
        products: [ram8],
      }),
    ).toBeNull()
  })

  it('stays idempotent when reapplied from intake specs', () => {
    const input = {
      productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD',
      specsAtIntake: 'i5, 4GB RAM, 256GB SSD',
      parts: [{ partName: ram8.name, productId: ram8.id, status: 'used' }],
      products: [ram8],
    }
    const first = applyRefurbPartsToUnitName(input)
    const second = applyRefurbPartsToUnitName(input)
    expect(first?.ramGb).toBe(12)
    expect(second?.sellingName).toBe(first?.sellingName)
  })

  it('does not stack RAM when the job title already shows the after-name', () => {
    const result = refurbishmentSellingNamePatch({
      job: {
        productName: 'HP EliteBook 840 G5 - i5, 12GB RAM, 256GB SSD',
        specs: 'HP EliteBook 840 G5 - i5, 12GB RAM, 256GB SSD',
        specsAtIntake: 'i5, 4GB RAM, 256GB SSD',
        partsNeeded: [{ partName: ram8.name, productId: ram8.id, status: 'used' }],
      },
      serial: { productName: 'HP EliteBook 840 G5 - i5, 4GB RAM, 256GB SSD' },
      products: [ram8],
    })
    expect(result?.ramGb).toBe(12)
    expect(result?.sellingName).toMatch(/12GB RAM/)
  })
})
