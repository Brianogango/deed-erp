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
    const legacy = clientItem({ id: 'seed-1', name: 'Old Demo Product' })
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
})
