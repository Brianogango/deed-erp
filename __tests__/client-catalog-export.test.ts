import { describe, expect, it } from 'vitest'
import { buildClientCatalogRowsFromTable } from '@/lib/inventory/client-catalog-export'

describe('client-facing Product Catalog export', () => {
  const headers = ['Product', 'Category', 'Condition', 'Available', 'Cost', 'Sale price', 'GP %', 'Last update']

  it('bundles matching model/spec rows and sums their available quantity', () => {
    const rows = buildClientCatalogRowsFromTable(headers, [
      ['HP EliteBook 840 G6 - 8th Gen Intel Core i5, 8GB RAM, 256GB SSD, 14" FHD', 'Laptops', 'Refurbished', 2, 18000, 28000, 20, '2026-09-01'],
      ['HP EliteBook 840 G6 - 8th Gen Intel Core i5, 8GB RAM, 256GB SSD, 14" FHD', 'Laptops', 'New', 3, 19000, 30000, 20, '2026-09-02'],
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].model).toContain('HP EliteBook 840 G6')
    expect(rows[0].specs).toContain('Intel Core i5')
    expect(rows[0].specs).toContain('8GB RAM')
    expect(rows[0].specs).toContain('256GB')
    expect(rows[0].qty).toBe(5)
    expect(rows[0].priceMin).toBe(28000)
    expect(rows[0].priceMax).toBe(30000)
    expect(rows[0].priceLabel).toContain('28,000')
    expect(rows[0].priceLabel).toContain('30,000')
  })

  it('never carries internal cost, GP, condition, category or last-update fields into client rows', () => {
    const [row] = buildClientCatalogRowsFromTable(headers, [
      ['Lenovo ThinkPad T14 Gen 2 - 11th Gen Intel Core i5, 16GB RAM, 512GB SSD, 14" FHD', 'Laptops', 'Refurbished', 2, 27000, 41000, 20, '2026-09-01'],
    ])

    expect(Object.keys(row)).toEqual(expect.arrayContaining(['model', 'specs', 'qty', 'priceLabel']))
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['cost', 'costPrice', 'gp', 'margin', 'condition', 'category', 'lastUpdate']))
  })

  it('drops zero-availability rows from the customer catalog', () => {
    const rows = buildClientCatalogRowsFromTable(headers, [
      ['Dell Latitude 7400 - 8th Gen Intel Core i7, 8GB RAM, 256GB SSD', 'Laptops', 'Refurbished', 0, 25000, 33500, 20, '2026-09-01'],
    ])
    expect(rows).toHaveLength(0)
  })
})
