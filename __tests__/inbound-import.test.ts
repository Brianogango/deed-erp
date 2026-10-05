import { describe, it, expect } from 'vitest'
import { applyProductPicks, buildInboundLines, rowsFromSheet, splitSerials } from '@/lib/inventory/inbound-import'

const products = [
  { id: 'p-845', name: 'HP EliteBook 845 G7', sku: 'HP-845-G7', requiresSerial: true, costPrice: 38000 },
  { id: 'p-cable', name: 'USB-C Cable 2m', sku: 'USBC-2M', requiresSerial: false },
]

describe('inbound import', () => {
  it('reads sheets with any reasonable headings, one serial per row or a list', () => {
    const rows = rowsFromSheet([
      { 'Product Name': 'HP EliteBook 845 G7', 'Serial No.': '5cg1234abc', 'Unit Price': '40,000' },
      { Model: 'HP EliteBook 845 G7', 'S/N': '5CG1234ABD' },
      { Item: 'USB-C Cable 2m', Quantity: 10, Cost: 450 },
      { Description: 'HP EliteBook 845 G7', Serials: 'AAA111; AAA222, AAA333', Qty: 3 },
      { Notes: '' },
    ])
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ serials: ['5CG1234ABC'], unitCost: 40000 })
    expect(rows[3].serials).toEqual(['AAA111', 'AAA222', 'AAA333'])
    expect(splitSerials('X1Y2Z3\nQ9W8E7')).toEqual(['X1Y2Z3', 'Q9W8E7'])
    // The downloadable template's own headings
    expect(rowsFromSheet([{ Product: 'X', SKU: '', 'Serial Number': 'ABC123', Qty: '1', 'Unit Cost (KES)': '30,000' }])[0])
      .toMatchObject({ unitCost: 30000, qty: 1, serials: ['ABC123'] })
  })

  it('groups per product, counts a serial row as one unit and falls back to the catalogue cost', () => {
    const lines = buildInboundLines(rowsFromSheet([
      { Product: 'HP EliteBook 845 G7', Serial: 'S0001' },
      { Product: 'hp elitebook 845 g7 - Ryzen 5, 16GB', Serial: 'S0002' },
      { SKU: 'USBC-2M', Qty: 5 },
    ]), products, new Set())
    expect(lines).toEqual([
      expect.objectContaining({ productId: 'p-845', qty: 2, serials: ['S0001', 'S0002'], unitCost: 38000, issues: [] }),
      expect.objectContaining({ productId: 'p-cable', qty: 5, issues: [] }),
    ])
  })

  it('flags missing serials, duplicates, serials already on file and unknown products', () => {
    const lines = buildInboundLines([
      { product: 'HP EliteBook 845 G7', qty: 3, serials: ['S1', 'S1X', 'S1X'] },
      { product: 'Lenovo X1 Carbon', serials: ['OLD001'] },
    ], products, new Set(['OLD001']))
    expect(lines[0].issues.join(' ')).toMatch(/Listed twice: S1X/)
    expect(lines[1].issues.join(' ')).toMatch(/not in the product list.*|Already in the system: OLD001/)
    expect(lines[1].issues).toHaveLength(2)
    const short = buildInboundLines([{ product: 'HP EliteBook 845 G7', qty: 2, serials: ['S9'] }], products, new Set())
    expect(short[0].issues).toEqual(['1 serial number for 2 units'])
  })

  it('applies a product picked for an unmatched row', () => {
    const rows = [{ product: 'Elitebook845', serials: ['Z1'] }]
    expect(buildInboundLines(rows, products, new Set())[0].key).toBe('?elitebook845')
    const picked = buildInboundLines(applyProductPicks(rows, { elitebook845: 'p-845' }, products), products, new Set())
    expect(picked[0]).toMatchObject({ productId: 'p-845', qty: 1, issues: [] })
  })
})
