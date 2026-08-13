import { describe, expect, it } from 'vitest'
import { resolveAddSaleOrderLineTaxRate } from '@/lib/sale-order-line-tax'
import { buildSaleOrderItemsNestedWrite, isSaleOrderSectionLine } from '@/lib/sale-order-items-write'
import { validateSaleOrderLines } from '@/lib/sale-order-line-validation'

describe('resolveAddSaleOrderLineTaxRate', () => {
  it('uses the Add Product VAT checkbox rate for new lines', () => {
    expect(resolveAddSaleOrderLineTaxRate({ explicitTaxRate: 16 })).toBe(16)
    expect(resolveAddSaleOrderLineTaxRate({ explicitTaxRate: 0 })).toBe(0)
  })

  it('upgrades a merged line when VAT is checked on re-add', () => {
    expect(resolveAddSaleOrderLineTaxRate({
      explicitTaxRate: 16,
      existingTaxRate: 0,
      merging: true,
    })).toBe(16)
  })

  it('keeps existing VAT when re-adding without the checkbox', () => {
    expect(resolveAddSaleOrderLineTaxRate({
      explicitTaxRate: 0,
      existingTaxRate: 16,
      merging: true,
    })).toBe(16)
  })
})

describe('section lines vs VAT saves', () => {
  it('treats qty-0 productless rows as sections for validation so VAT edits can save', () => {
    expect(validateSaleOrderLines([
      { lineType: 'section', description: 'Hardware', qty: 0 },
      { description: 'Section', qty: 0, productId: '' },
      { description: 'Laptop', qty: 1, unitPrice: 1000, taxRate: 16, productId: 'p1' },
    ])).toBeNull()
  })

  it('persists section headings as qty-0 rows and still writes line VAT', () => {
    const existing = [{
      id: '11111111-1111-4111-8111-111111111111',
      productId: null,
      description: 'Section',
      qty: 0,
      qtyDelivered: 0,
      qtyInvoiced: 0,
      unitPrice: 0,
      taxRate: 0,
      lineTotal: 0,
      notes: null,
      serialNumberId: null,
    }, {
      id: '22222222-2222-4222-8222-222222222222',
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      description: 'Laptop',
      qty: 1,
      qtyDelivered: 0,
      qtyInvoiced: 0,
      unitPrice: 1000,
      taxRate: 0,
      lineTotal: 1000,
      notes: null,
      serialNumberId: null,
    }]
    expect(isSaleOrderSectionLine({ lineType: 'section', qty: 0 })).toBe(true)
    expect(isSaleOrderSectionLine({ qty: 0, productId: '' })).toBe(true)

    const nested = buildSaleOrderItemsNestedWrite(
      [
        {
          id: existing[0].id,
          lineType: 'section',
          description: 'Hardware',
          qty: 0,
          productId: '',
          taxRate: 0,
        },
        {
          id: existing[1].id,
          productId: existing[1].productId,
          description: 'Laptop',
          qty: 1,
          unitPrice: 1000,
          taxRate: 16,
        },
      ],
      existing,
    )
    expect(nested.create).toBeUndefined()
    expect(nested.deleteMany).toBeUndefined()
    expect(nested.update).toHaveLength(2)
    const laptop = nested.update?.find(u => u.where.id === existing[1].id)
    expect(laptop?.data.taxRate).toBe(16)
    const section = nested.update?.find(u => u.where.id === existing[0].id)
    expect(section?.data.qty).toBe(0)
    expect(section?.data.taxRate).toBe(0)
  })
})
