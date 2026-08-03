import { describe, expect, it } from 'vitest'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'

describe('mapDbInvoiceItemsToClientLines sections', () => {
  it('preserves sort order and section headings', () => {
    const lines = mapDbInvoiceItemsToClientLines([
      { id: '2', description: 'Laptop', qty: 1, unitPrice: 1000, taxRate: 16, lineSubtotal: 1000, sortOrder: 1, productId: 'p1' },
      { id: '1', description: 'Hardware', qty: 0, unitPrice: 0, taxRate: 0, lineSubtotal: 0, sortOrder: 0 },
    ])
    expect(lines.map(l => l.id)).toEqual(['1', '2'])
    expect(lines[0].lineType).toBe('section')
    expect(lines[0].description).toBe('Hardware')
    expect(lines[1].lineType).toBe('item')
  })
})
