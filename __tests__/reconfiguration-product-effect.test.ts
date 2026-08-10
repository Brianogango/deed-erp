import { describe, expect, it } from 'vitest'
import {
  mergeEffectsIntoTarget,
  parseProductReconfigEffect,
} from '@/lib/reconfiguration/product-effect'

describe('parseProductReconfigEffect', () => {
  it('reads explicit specs.reconfiguration', () => {
    const effect = parseProductReconfigEffect({
      id: 'p1',
      name: 'Upgrade kit',
      specs: { reconfiguration: { slot: 'ram', targetRamGb: 32, additiveRam: false } },
    })
    expect(effect).toMatchObject({
      slot: 'ram',
      targetRamGb: 32,
      productId: 'p1',
      source: 'explicit',
    })
  })

  it('infers RAM from product name', () => {
    const effect = parseProductReconfigEffect({
      id: 'p2',
      name: '16GB DDR4 RAM Upgrade',
      specs: {},
    })
    expect(effect?.slot).toBe('ram')
    expect(effect?.targetRamGb).toBe(16)
    expect(effect?.source).toBe('name')
  })

  it('infers SSD from product name', () => {
    const effect = parseProductReconfigEffect({
      id: 'p3',
      name: '512GB NVMe SSD',
      specs: {},
    })
    expect(effect?.slot).toBe('storage')
    expect(effect?.targetStorageGb).toBe(512)
    expect(effect?.storageType).toBe('SSD')
  })

  it('returns null for ordinary laptop products', () => {
    expect(parseProductReconfigEffect({
      id: 'p4',
      name: 'Lenovo ThinkPad T14',
      specs: { productKind: 'storable' },
    })).toBeNull()
  })

  it('returns null when laptop titles include RAM+SSD specs', () => {
    expect(parseProductReconfigEffect({
      id: 'p5',
      name: 'HP ProBook 450 G8 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      specs: {},
    })).toBeNull()
    expect(parseProductReconfigEffect({
      id: 'p6',
      name: 'Lenovo ThinkPad X1 Carbon Gen 6 - 8th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      specs: {},
    })).toBeNull()
  })
})

describe('mergeEffectsIntoTarget', () => {
  it('builds absolute RAM + storage target from current + effects', () => {
    const target = mergeEffectsIntoTarget({
      current: { totalRamGb: 8, primaryStorageGb: 256, storageType: 'SSD' },
      effects: [
        {
          slot: 'ram',
          targetRamGb: 16,
          productId: 'ram-1',
          productName: '16GB RAM',
          source: 'name',
        },
        {
          slot: 'storage',
          targetStorageGb: 512,
          storageType: 'SSD',
          productId: 'ssd-1',
          productName: '512GB SSD',
          source: 'name',
        },
      ],
    })
    expect(target).toMatchObject({
      changeScope: 'both',
      totalRamGb: 16,
      primaryStorageGb: 512,
      ramProductId: 'ram-1',
      storageProductId: 'ssd-1',
    })
  })

  it('supports additive RAM upgrades', () => {
    const target = mergeEffectsIntoTarget({
      current: { totalRamGb: 8, primaryStorageGb: 256, storageType: 'SSD' },
      effects: [{
        slot: 'ram',
        addRamGb: 8,
        additiveRam: true,
        productId: 'ram-2',
        productName: '8GB add-on',
        source: 'explicit',
      }],
    })
    expect(target).toMatchObject({ changeScope: 'ram', totalRamGb: 16, additiveRam: true })
  })

  it('returns null when effects match current specs (no-op)', () => {
    const target = mergeEffectsIntoTarget({
      current: { totalRamGb: 16, primaryStorageGb: 512, storageType: 'SSD' },
      effects: [{
        slot: 'ram',
        targetRamGb: 16,
        productId: 'ram-1',
        productName: '16GB RAM',
        source: 'name',
      }],
    })
    expect(target).toBeNull()
  })
})
