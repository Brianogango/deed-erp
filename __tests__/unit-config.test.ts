import { describe, expect, it } from 'vitest'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import {
  catalogDeviceConfig,
  compactSpecsString,
  fillEmptySerialSpecs,
  fillMissingCatalogDeviceConfig,
  resolveUnitConfig,
  seedSerialSpecs,
  withCatalogDeviceConfig,
} from '@/lib/reconfiguration/unit-config'

describe('parseSpecsString live catalog titles', () => {
  it('reads the dominant Dell/HP comma style including screen size', () => {
    const parsed = parseSpecsString(
      'HP EliteBook 830 G8 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD - 13"',
    )
    expect(parsed.totalRamGb).toBe(8)
    expect(parsed.primaryStorageGb).toBe(256)
    expect(parsed.storageType).toMatch(/SSD/i)
    expect(parsed.processorGeneration).toMatch(/11th Gen/i)
  })

  it('reads Dell Latitude 5410 8/256', () => {
    const parsed = parseSpecsString('Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD')
    expect(parsed.totalRamGb).toBe(8)
    expect(parsed.primaryStorageGb).toBe(256)
  })

  it('treats DDR without the word RAM as RAM', () => {
    const parsed = parseSpecsString('HP 250 G8 8GB DDR4 3200')
    expect(parsed.totalRamGb).toBe(8)
  })

  it('reads 8G 256GB DOS', () => {
    const parsed = parseSpecsString('HP 15 8G 256GB DOS')
    expect(parsed.totalRamGb).toBe(8)
    expect(parsed.primaryStorageGb).toBe(256)
  })

  it('reads NVMe with M.2 filler words', () => {
    const parsed = parseSpecsString('ThinkPad T14 16GB RAM, 512GB M.2 PCIe NVMe SSD')
    expect(parsed.totalRamGb).toBe(16)
    expect(parsed.primaryStorageGb).toBe(512)
    expect(parsed.storageType).toMatch(/NVMe/i)
  })

  it('reads 1TB SSD as 1024GB', () => {
    const parsed = parseSpecsString('i5, 16GB RAM, 1TB SSD')
    expect(parsed.totalRamGb).toBe(16)
    expect(parsed.primaryStorageGb).toBe(1024)
  })

  it('reads 16GB 1TB without RAM/SSD words', () => {
    const parsed = parseSpecsString('Latitude 5420 16GB 1TB')
    expect(parsed.totalRamGb).toBe(16)
    expect(parsed.primaryStorageGb).toBe(1024)
  })

  it('reads Storage as a storage type and does not treat it as RAM', () => {
    const parsed = parseSpecsString('HP Desktop 500GB Storage')
    expect(parsed.totalRamGb).toBe(0)
    expect(parsed.primaryStorageGb).toBe(500)
  })

  it('does not treat 8th Gen as RAM', () => {
    const parsed = parseSpecsString('HP EliteBook 840 G5 - 8th Gen Intel Core i5')
    expect(parsed.totalRamGb).toBe(0)
    expect(parsed.processorGeneration).toMatch(/8th Gen/i)
  })
})

describe('catalogDeviceConfig / seedSerialSpecs', () => {
  it('stores RAM/SSD from a laptop name onto product.specs', () => {
    const specs = withCatalogDeviceConfig(
      { productKind: 'storable', unit: 'pcs', taxRatePct: 16 },
      'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      'Laptops',
    )
    expect(specs.productKind).toBe('storable')
    expect(specs.deviceConfig).toMatchObject({ totalRamGb: 8, primaryStorageGb: 256 })
  })

  it('ignores parts SKUs', () => {
    expect(catalogDeviceConfig('8GB DDR4 SODIMM Laptop RAM - 2666MHz', 'Parts & Components')).toBeNull()
  })

  it('accepts manual GB on a bare model name', () => {
    const config = catalogDeviceConfig('HP EliteBook 830 G8', 'Laptops', {
      totalRamGb: 8,
      primaryStorageGb: 256,
    })
    expect(config).toMatchObject({ totalRamGb: 8, primaryStorageGb: 256 })
  })

  it('seeds serial specs from the product name when GRN specs are blank', () => {
    expect(
      seedSerialSpecs({
        typedSpecs: '',
        productName: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      }),
    ).toMatch(/8GB RAM/)
  })

  it('keeps typed GRN specs', () => {
    expect(
      seedSerialSpecs({
        typedSpecs: '16GB RAM, 512GB SSD',
        productName: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      }),
    ).toBe('16GB RAM, 512GB SSD')
  })

  it('returns undefined for a bare title with no typed specs', () => {
    expect(seedSerialSpecs({ productName: 'HP EliteBook 830 G8' })).toBeUndefined()
  })

  it('compactSpecsString skips empty config', () => {
    expect(compactSpecsString({ totalRamGb: 0, primaryStorageGb: null })).toBe('')
  })

  it('fillMissingCatalogDeviceConfig writes RAM/SSD from an existing laptop title', () => {
    const result = fillMissingCatalogDeviceConfig(
      { productKind: 'storable', taxRatePct: 16 },
      'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      'Laptops',
    )
    expect(result.changed).toBe(true)
    expect(result.specs.productKind).toBe('storable')
    expect(result.deviceConfig).toMatchObject({ totalRamGb: 8, primaryStorageGb: 256 })
  })

  it('fillMissingCatalogDeviceConfig is a no-op when specs already match the title', () => {
    const specs = {
      productKind: 'storable',
      deviceConfig: { totalRamGb: 8, primaryStorageGb: 256, storageType: 'SSD' },
    }
    const result = fillMissingCatalogDeviceConfig(
      specs,
      'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      'Laptops',
    )
    expect(result.changed).toBe(false)
  })

  it('fillMissingCatalogDeviceConfig does not clear a bare SKU', () => {
    const specs = { productKind: 'storable', deviceConfig: { totalRamGb: 16, primaryStorageGb: 512, storageType: 'SSD' } }
    const result = fillMissingCatalogDeviceConfig(specs, 'HP EliteBook 830 G8', 'Laptops')
    expect(result.changed).toBe(false)
    expect(result.deviceConfig).toMatchObject({ totalRamGb: 16, primaryStorageGb: 512 })
  })

  it('fillEmptySerialSpecs stamps blank serials and leaves live specs alone', () => {
    const product = { name: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD' }
    expect(fillEmptySerialSpecs({ specs: '' }, product).changed).toBe(true)
    expect(fillEmptySerialSpecs({ specs: '' }, product).specs).toMatch(/8GB RAM/)
    expect(fillEmptySerialSpecs({ specs: '16GB RAM, 512GB SSD' }, product)).toEqual({
      specs: '16GB RAM, 512GB SSD',
      changed: false,
    })
  })
})

describe('resolveUnitConfig', () => {
  it('uses the product name when serial specs are empty', () => {
    const { current, source } = resolveUnitConfig({
      serialSpecs: '',
      productName: 'HP EliteBook 830 G8 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD - 13"',
    })
    expect(source).toBe('product_name')
    expect(current.totalRamGb).toBe(8)
    expect(current.primaryStorageGb).toBe(256)
  })

  it('prefers a live snapshot over a stale 8/256 catalog title', () => {
    const { current, source } = resolveUnitConfig({
      snapshot: {
        totalRamGb: 16,
        primaryStorageGb: 512,
        ramComposition: [],
        displayName: 'HP EliteBook 830 G8 - 16GB RAM, 512GB SSD',
      },
      serialSpecs: '16GB RAM, 512GB SSD',
      productName: 'HP EliteBook 830 G8 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD - 13"',
    })
    expect(source).toBe('snapshot')
    expect(current.totalRamGb).toBe(16)
    expect(current.primaryStorageGb).toBe(512)
  })

  it('treats a 0/0 snapshot as missing and falls through to the product name', () => {
    const { current, source } = resolveUnitConfig({
      snapshot: { totalRamGb: 0, primaryStorageGb: 0, ramComposition: [], displayName: 'Device' },
      serialSpecs: '',
      productName: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
    })
    expect(source).toBe('product_name')
    expect(current.totalRamGb).toBe(8)
    expect(current.primaryStorageGb).toBe(256)
  })

  it('uses structured product.specs before parsing the name', () => {
    const { current, source } = resolveUnitConfig({
      serialSpecs: '',
      productSpecs: { productKind: 'storable', deviceConfig: { totalRamGb: 16, primaryStorageGb: 512, storageType: 'SSD' } },
      productName: 'HP EliteBook 830 G8',
    })
    expect(source).toBe('product_specs')
    expect(current.totalRamGb).toBe(16)
    expect(current.primaryStorageGb).toBe(512)
  })

  it('is unresolved for a bare SKU with no specs', () => {
    const { current, source } = resolveUnitConfig({
      serialSpecs: '',
      productName: 'HP EliteBook 830 G8',
    })
    expect(source).toBe('unresolved')
    expect(current.totalRamGb).toBe(0)
    expect(current.primaryStorageGb).toBeNull()
  })

  it('prefers installed modules over the product name', () => {
    const { current, source } = resolveUnitConfig({
      installed: [
        {
          id: 'i1',
          componentProductId: 'ram-8',
          category: 'ram',
          slotType: 'ram_slot',
          slotNumber: 1,
          capacityGb: 8,
          quantity: 1,
          removable: true,
          status: 'installed',
          costAtInstallation: 0,
        },
      ],
      productName: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 16GB RAM, 256GB SSD',
    })
    expect(source).toBe('installed')
    expect(current.totalRamGb).toBe(8)
  })

  it('does not let a newly added stick shrink RAM below the unit snapshot', () => {
    const { current } = resolveUnitConfig({
      installed: [
        {
          id: 'i2',
          componentProductId: 'ram-4',
          category: 'ram',
          slotType: 'ram_slot',
          slotNumber: 2,
          capacityGb: 4,
          quantity: 1,
          removable: true,
          status: 'installed',
          costAtInstallation: 0,
        },
      ],
      snapshot: {
        totalRamGb: 12,
        primaryStorageGb: 256,
        storageType: 'SSD',
        ramComposition: [
          { slotType: 'ram_slot', slotNumber: 1, capacityGb: 8, removable: true },
          { slotType: 'ram_slot', slotNumber: 2, capacityGb: 4, removable: true },
        ],
        displayName: 'HP EliteBook 745 G6 - AMD Ryzen 5 PRO 3500U, 12GB RAM, 256GB SSD',
      },
      productName: 'HP EliteBook 745 G6 - AMD Ryzen 5 PRO 3500U, 8GB RAM, 256GB SSD',
    })
    expect(current.totalRamGb).toBe(12)
    expect(current.primaryStorageGb).toBe(256)
    expect(current.displayName).toMatch(/12GB RAM/)
  })
})
