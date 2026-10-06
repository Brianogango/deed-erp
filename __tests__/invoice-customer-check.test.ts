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
