import { describe, it, expect } from 'vitest'
import { findMisfiledInvoices, type InvoiceForCheck } from '@/lib/finance/invoice-customer-check'

const inv = (over: Partial<InvoiceForCheck>): InvoiceForCheck => ({
  id: 'i1', ref: 'POS/0135', date: '2026-09-26', total: 33000, clientId: 'john', clientName: 'John Malcolm Odhiambo',
  saleOrderId: null, repairId: null, isPosInvoice: true, ...over,
})

describe('findMisfiledInvoices', () => {
  it('flags a POS invoice filed under someone other than the till ticket customer', () => {
    const rows = findMisfiledInvoices({
      invoices: [inv({})],
      posByInvoiceId: new Map([['i1', { clientId: 'derrick', name: 'Derrick Mwenda' }]]),
      saleOrders: new Map(), repairs: new Map(),
    })
    expect(rows).toEqual([expect.objectContaining({ ref: 'POS/0135', filedUnder: 'John Malcolm Odhiambo', shouldBe: 'Derrick Mwenda', targetClientId: 'derrick', source: 'pos' })])
  })

  it('leaves correct invoices, walk-ins and same-name records alone', () => {
    const rows = findMisfiledInvoices({
      invoices: [
        inv({ id: 'a', clientId: 'derrick', clientName: 'Derrick Mwenda' }),
        inv({ id: 'b', clientId: 'walk', clientName: 'Walk-in Customer' }),
        inv({ id: 'c', clientId: 'derrick2', clientName: 'derrick  mwenda' }),
      ],
      posByInvoiceId: new Map([
        ['a', { clientId: 'derrick', name: 'Derrick Mwenda' }],
        ['b', { clientId: null, name: 'Walk-in Customer' }],
        ['c', { clientId: 'derrick', name: 'Derrick Mwenda' }],
      ]),
      saleOrders: new Map(), repairs: new Map(),
    })
    expect(rows).toEqual([])
  })

  it('checks sale-order and repair invoices against their documents', () => {
    const rows = findMisfiledInvoices({
      invoices: [
        inv({ id: 's', ref: 'INV/1', isPosInvoice: false, saleOrderId: 'so1' }),
        inv({ id: 'r', ref: 'INV/2', isPosInvoice: false, repairId: 'rep1', clientId: 'mary', clientName: 'Mary' }),
      ],
      posByInvoiceId: new Map(),
      saleOrders: new Map([['so1', { clientId: 'acme', name: 'Acme Ltd' }]]),
      repairs: new Map([['rep1', { clientId: 'mary', name: 'Mary' }]]),
    })
    expect(rows.map(r => [r.ref, r.shouldBe, r.source])).toEqual([['INV/1', 'Acme Ltd', 'sale_order']])
  })
})

describe('repair invoices whose sale order carries the same wrong customer', () => {
  it('checks against the repair, not the sale order', () => {
    const rows = findMisfiledInvoices({
      invoices: [{ id: 'i1', ref: 'INV/2026/0170', date: '2026-08-30', total: 6000, clientId: 'brian', clientName: 'Brian Ogango', saleOrderId: 'so89', repairId: 'r1', isPosInvoice: false }],
      posByInvoiceId: new Map(),
      saleOrders: new Map([['so89', { clientId: 'brian', name: 'Brian Ogango' }]]),
      repairs: new Map([['r1', { clientId: 'jane', name: 'Jane Wanjiru' }]]),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'repair', filedUnder: 'Brian Ogango', shouldBe: 'Jane Wanjiru', targetClientId: 'jane', saleOrderId: 'so89' })
  })
})
