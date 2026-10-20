import { describe, expect, it } from 'vitest'
import { repairsByInvoice } from '@/lib/repair/repair-invoice-index'

const repairs = [
  { id: 'r1', invoiceId: 'i1' },
  { id: 'r2', saleOrderId: 'so2' },
  { id: 'r3', saleOrderId: 'so3' },
  { id: 'r4', saleOrderId: 'so3' },
  { id: 'r5' },
]

describe('repairs on each invoice', () => {
  const index = repairsByInvoice(repairs, [
    { id: 'i1' },                                            // only the repair knows its invoice
    { id: 'i2', saleOrderId: 'so2' },                        // billed through the repair's sale order
    { id: 'i3', saleOrderId: 'so3', repairId: 'r3' },        // two repairs on one order, only the first named
    { id: 'i4', lines: [{ repairId: 'r5' }, {}] },           // consolidated lines
    { id: 'i5', repairId: 'gone' },                          // a repair this user cannot see
    { id: 'i6', type: 'vendor_bill', repairId: 'r1' },       // bills are never repair revenue
    { id: 'i7', saleOrderId: 'so-other' },                   // an ordinary sale
  ])
  it('links through the repair, its sale order, and repair lines', () => {
    expect(index.get('i1')).toEqual(['r1'])
    expect(index.get('i2')).toEqual(['r2'])
    expect(index.get('i3')?.sort()).toEqual(['r3', 'r4'])
    expect(index.get('i4')).toEqual(['r5'])
  })
  it('leaves out invisible repairs, vendor bills and ordinary sales', () => {
    expect(index.has('i5')).toBe(false)
    expect(index.has('i6')).toBe(false)
    expect(index.has('i7')).toBe(false)
  })
})
