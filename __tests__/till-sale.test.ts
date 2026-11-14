import { describe, expect, it } from 'vitest'
import { isPosNumber, isTillSale } from '@/lib/accounting/till-sale'

describe('isTillSale', () => {
  it('a POS-flagged invoice, or an older POS-numbered one with no sale order', () => {
    expect(isTillSale({ invoiceNumber: 'POS/0012', isPosInvoice: true })).toBe(true)
    expect(isTillSale({ invoiceNumber: 'POS/0012', isPosInvoice: false, saleOrderId: null })).toBe(true)
  })
  it('an invoice raised from a sale order is never a till sale, whatever its number (POS/0037)', () => {
    expect(isTillSale({ invoiceNumber: 'POS/0037', isPosInvoice: false, saleOrderId: 'so-72' })).toBe(false)
    expect(isTillSale({ invoiceNumber: 'INV/2026/0100', isPosInvoice: false })).toBe(false)
  })
  it('isPosNumber', () => {
    expect(isPosNumber('POS/0037')).toBe(true)
    expect(isPosNumber('POSSESS/0003')).toBe(false)
    expect(isPosNumber('INV/2026/0001')).toBe(false)
  })
})
