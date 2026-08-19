import { describe, it, expect } from 'vitest'
import { mergeCatalogProducts, type ClientCatalogProduct, type CatalogApiRow } from '@/lib/catalog-merge'

const CONFIG = {
  Laptops: { serialRequired: true },
  'Parts & Components': { serialRequired: false },
}

const clientItem = (over: Partial<ClientCatalogProduct>): ClientCatalogProduct => ({
  id: 'p-1', sku: 'SKU-1', barcode: '', name: 'Laptop A', description: 'old desc',
  category: 'Laptops', salePrice: 100, costPrice: 50, minStock: 5, isActive: true,
  unit: 'pcs', image: '💻', taxRate: 16, stockQty: 3, canBeSold: true,
  canBePurchased: true, warrantyMonths: 12, requiresSerial: true,
  saleAccountCode: '5001', costAccountCode: '6101',
  ...over,
})

const apiRow = (over: Partial<CatalogApiRow>): CatalogApiRow => ({
  id: 'p-1', sku: 'SKU-1', barcode: null, name: 'Laptop A', description: 'new desc',
  sellingPrice: 200, costPrice: 80, reorderLevel: 2, isActive: true,
  category: { name: 'Laptops' },
  ...over,
})

describe('mergeCatalogProducts', () => {
  it('catalog owns identity/commercial fields; client-only fields survive', () => {
    const merged = mergeCatalogProducts([clientItem({})], [apiRow({})], CONFIG)
    expect(merged).toHaveLength(1)
    const p = merged[0]
    expect(p.salePrice).toBe(200)          // catalog wins
    expect(p.costPrice).toBe(80)
    expect(p.description).toBe('new desc')
    expect(p.minStock).toBe(2)
    expect(p.stockQty).toBe(3)             // client-only field preserved
    expect(p.warrantyMonths).toBe(12)
    expect(p.image).toBe('💻')
  })

  it('adds catalog rows missing from the client store with category defaults', () => {
    const merged = mergeCatalogProducts(
      [clientItem({})],
      [apiRow({}), apiRow({ id: 'p-2', sku: 'SKU-2', name: 'Screen Panel', sellingPrice: '1500', category: { name: 'Parts & Components' } })],
      CONFIG,
    )
    expect(merged).toHaveLength(2)
    const added = merged.find(p => p.id === 'p-2')!
    expect(added.name).toBe('Screen Panel')
    expect(added.salePrice).toBe(1500)     // decimal-as-string coerced
    expect(added.category).toBe('Parts & Components')
    expect(added.requiresSerial).toBe(false)
    expect(added.taxRate).toBe(16)
    expect(added.canBeSold).toBe(true)
  })

  it('keeps store-only legacy items at the end of the list', () => {
    const legacy = clientItem({ id: 'seed-1', name: 'Old Demo Product', sku: 'SEED-OLD' })
    const merged = mergeCatalogProducts([clientItem({}), legacy], [apiRow({})], CONFIG)
    expect(merged).toHaveLength(2)
    expect(merged.at(-1)!.id).toBe('seed-1')
  })

  it('matches by name when the client id differs (pre-relational entries)', () => {
    const local = clientItem({ id: 'local-guid', name: 'Laptop A', stockQty: 7 })
    const merged = mergeCatalogProducts([local], [apiRow({})], CONFIG)
    expect(merged).toHaveLength(1)         // no duplicate row
    expect(merged[0].id).toBe('p-1')       // adopts the catalog id
    expect(merged[0].stockQty).toBe(7)     // still keeps client-only data
  })

  it('marks catalog-deactivated products inactive even if the store says active', () => {
    const merged = mergeCatalogProducts([clientItem({ isActive: true })], [apiRow({ isActive: false })], CONFIG)
    expect(merged[0].isActive).toBe(false)
  })

  it('copies trackingMethod from the catalog row', () => {
    const merged = mergeCatalogProducts(
      [clientItem({})],
      [apiRow({ trackingMethod: 'SERIAL' })],
      CONFIG,
    )
    expect(merged[0].trackingMethod).toBe('SERIAL')
    expect(merged[0].requiresSerial).toBe(true)
  })

  it('hydrates productType and pricingCategoryId from Prisma row/specs', () => {
    const merged = mergeCatalogProducts(
      [clientItem({ productType: 'new', pricingCategoryId: 'stale' } as any)],
      [apiRow({
        productType: 'refurbished',
        specs: { pricingCategoryId: 'refurb_laptops', productKind: 'storable', unit: 'pcs', taxRatePct: 16 },
      })],
      CONFIG,
    )
    expect(merged[0].productType).toBe('refurbished')
    expect(merged[0].pricingCategoryId).toBe('refurb_laptops')
    expect(merged[0].productKind).toBe('storable')
  })

  it('hydrates deviceConfig from Prisma specs for reconfiguration', () => {
    const merged = mergeCatalogProducts(
      [clientItem({})],
      [apiRow({
        specs: {
          productKind: 'storable',
          deviceConfig: { totalRamGb: 8, primaryStorageGb: 256, storageType: 'SSD' },
        },
      })],
      CONFIG,
    )
    expect(merged[0].deviceConfig).toMatchObject({ totalRamGb: 8, primaryStorageGb: 256 })
  })

  it('parses RAM/SSD from an existing catalog title when specs.deviceConfig is missing', () => {
    const merged = mergeCatalogProducts(
      [clientItem({ name: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD' })],
      [apiRow({
        name: 'Dell Latitude 5410 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
        specs: { productKind: 'storable' },
      })],
      CONFIG,
    )
    expect(merged[0].deviceConfig).toMatchObject({ totalRamGb: 8, primaryStorageGb: 256 })
  })
})

describe('mergeProductsStoreWrite', () => {
  it('keeps current-only product ids when a stale shorter list is written', async () => {
    const { mergeProductsStoreWrite } = await import('@/lib/catalog-merge')
    const current = [
      { id: 'a', name: 'Kept A' },
      { id: 'b', name: 'Kept B' },
      { id: 'c', name: 'New Catalog Product' },
    ]
    const incoming = [
      { id: 'a', name: 'Kept A updated' },
      { id: 'b', name: 'Kept B' },
    ]
    const merged = mergeProductsStoreWrite(current, incoming) as any[]
    expect(merged).toHaveLength(3)
    expect(merged.find(p => p.id === 'a')!.name).toBe('Kept A updated')
    expect(merged.find(p => p.id === 'c')!.name).toBe('New Catalog Product')
  })

  it('preserves client order so catalogue search does not reshuffle on sync', async () => {
    const { mergeProductsStoreWrite } = await import('@/lib/catalog-merge')
    const current = [
      { id: 'asus-1', name: 'ASUS 1', stockQty: 1 },
      { id: 'asus-2', name: 'ASUS 2', stockQty: 2 },
      { id: 'other', name: 'Other', stockQty: 3 },
    ]
    const incoming = [
      { id: 'other', name: 'Other', stockQty: 9 },
      { id: 'asus-2', name: 'ASUS 2', stockQty: 8 },
      { id: 'asus-1', name: 'ASUS 1', stockQty: 7 },
      { id: 'new', name: 'New', stockQty: 1 },
    ]
    const merged = mergeProductsStoreWrite(current, incoming) as any[]
    expect(merged.map(p => p.id)).toEqual(['asus-1', 'asus-2', 'other', 'new'])
    expect(merged[0].stockQty).toBe(7)
  })

  it('collapses optimistic UUID and Prisma UUID for the same product name', async () => {
    const { mergeProductsStoreWrite } = await import('@/lib/catalog-merge')
    const current = [
      { id: 'prisma-uuid', name: 'HP ProBook 450', sku: 'HP-PROBOOK-450-ABC' },
    ]
    const incoming = [
      { id: 'client-uuid', name: 'HP ProBook 450', sku: 'HP-PROBOOK-450-ABC' },
      { id: 'other', name: 'Other Item', sku: 'OTHER-1' },
    ]
    const merged = mergeProductsStoreWrite(current, incoming) as any[]
    expect(merged).toHaveLength(2)
    expect(merged.find(p => p.name === 'HP ProBook 450')!.id).toBe('prisma-uuid')
    expect(merged.find(p => p.id === 'other')).toBeTruthy()
  })
})

describe('mergeProductsRemoteState', () => {
  it('returns the same array reference when remote data is unchanged', async () => {
    const { mergeProductsRemoteState } = await import('@/lib/catalog-merge')
    const local = [{ id: 'a', name: 'A', stockQty: 1 }]
    const next = mergeProductsRemoteState(local, [{ id: 'a', name: 'A', stockQty: 1 }])
    expect(next).toBe(local)
  })
})

describe('mergeCatalogProducts preserveClientOrder', () => {
  it('keeps previous row order when refreshing from the API', () => {
    const prev = [
      clientItem({ id: 'p-2', name: 'Second', sku: 'SKU-2' }),
      clientItem({ id: 'p-1', name: 'Laptop A', sku: 'SKU-1' }),
    ]
    const merged = mergeCatalogProducts(
      prev,
      [apiRow({}), apiRow({ id: 'p-2', sku: 'SKU-2', name: 'Second' })],
      CONFIG,
      { preserveClientOrder: true },
    )
    expect(merged.map(p => p.id)).toEqual(['p-2', 'p-1'])
  })
})
