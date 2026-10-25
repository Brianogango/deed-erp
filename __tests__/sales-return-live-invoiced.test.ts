import { describe, it, expect } from 'vitest'
import { allocateSalesReturn, liveQtyInvoicedBySoLine } from '@/lib/sales/return-allocation'

// A customer return after the invoice was cancelled must not ask for a credit
// note: nothing is owed on a cancelled invoice.
const soLines = [{ id: 'l1', productId: 'laptop', qty: 2, qtyInvoiced: 2 }]
const inv = (o: Record<string, unknown>) => ({ saleOrderId: 'so1', type: 'customer_invoice', status: 'posted', total: 100000, lines: [{ productId: 'laptop', qty: 2 }], ...o })

describe('liveQtyInvoicedBySoLine', () => {
  it('a cancelled invoice no longer counts, so no credit note is needed', () => {
    const live = liveQtyInvoicedBySoLine('so1', soLines, [inv({ status: 'cancelled' })])
    expect(live.get('l1')).toBe(0)
    const allocation = allocateSalesReturn({
      soLines: [{ id: 'l1', productId: 'laptop', qty: 2, qtyDelivered: 2, qtyInvoiced: live.get('l1')!, unitPrice: 50000 }],
      returnLines: [{ productId: 'laptop', qty: 1 }],
    })
    expect(allocation.creditTotal).toBe(0)
  })

  it('an invoice in force still counts', () => {
    expect(liveQtyInvoicedBySoLine('so1', soLines, [inv({})]).get('l1')).toBe(2)
  })

  it('ignores down payments, credit notes and other orders; stored count caps it', () => {
    const live = liveQtyInvoicedBySoLine('so1', [{ ...soLines[0], qtyInvoiced: 1 }], [
      inv({}), inv({ isDownPayment: true }), inv({ total: -50000 }), inv({ saleOrderId: 'so2' }),
    ])
    expect(live.get('l1')).toBe(1)
  })
})
