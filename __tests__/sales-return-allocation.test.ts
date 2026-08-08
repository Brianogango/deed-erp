import { describe, expect, it } from 'vitest'
import { allocateSalesReturn } from '@/lib/sales/return-allocation'

describe('allocateSalesReturn', () => {
  it('return before invoice only reverses delivered qty', () => {
    const result = allocateSalesReturn({
      soLines: [{
        id: 'l1', productId: 'p1', productName: 'Laptop', qty: 5,
        qtyDelivered: 5, qtyInvoiced: 0, unitPrice: 10000, taxRate: 16,
      }],
      returnLines: [{ productId: 'p1', qty: 2 }],
    })
    expect(result.reverseDeliveredQty).toBe(2)
    expect(result.requiresCreditNote).toBe(false)
    expect(result.soLineAdjustments[0]).toMatchObject({ qtyDelivered: 3, qtyInvoiced: 0 })
    expect(result.creditTotal).toBe(0)
  })

  it('return after invoice creates credit note lines', () => {
    const result = allocateSalesReturn({
      soLines: [{
        id: 'l1', productId: 'p1', productName: 'Laptop', qty: 5,
        qtyDelivered: 5, qtyInvoiced: 5, unitPrice: 1000, taxRate: 16,
      }],
      returnLines: [{ productId: 'p1', qty: 1 }],
    })
    expect(result.requiresCreditNote).toBe(true)
    expect(result.creditLines[0]).toMatchObject({ qty: 1, unitPrice: 1000, subtotal: 1000, taxAmount: 160 })
    expect(result.creditTotal).toBe(1160)
    expect(result.soLineAdjustments[0]).toMatchObject({ qtyDelivered: 4, qtyInvoiced: 4 })
  })

  it('prefers draft invoice deductions before credit notes', () => {
    const result = allocateSalesReturn({
      soLines: [{
        id: 'l1', productId: 'p1', qty: 5,
        qtyDelivered: 5, qtyInvoiced: 5, unitPrice: 1000, taxRate: 0,
      }],
      returnLines: [{ productId: 'p1', qty: 2 }],
      draftInvoices: [{
        id: 'inv-draft',
        lines: [{ id: 'il1', productId: 'p1', qty: 2 }],
      }],
    })
    expect(result.draftInvoiceDeductions).toEqual([
      { invoiceId: 'inv-draft', lineId: 'il1', deductQty: 2 },
    ])
    expect(result.requiresCreditNote).toBe(false)
  })
})
