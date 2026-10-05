import { describe, it, expect } from 'vitest'
import { findInvoicedNotDelivered } from '@/lib/sales/invoiced-not-delivered'

const products = [
  { id: 'p-845', name: 'HP EliteBook 845 G7', requiresSerial: true },
  { id: 'p-fee', name: 'Diagnosis Fee', requiresSerial: false },
]
const so = (over = {}) => ({ id: 'so-4', ref: 'SO/2026/0004', status: 'sale', customerName: 'D.Light Kenya', lines: [{ productId: 'p-845', productName: 'HP EliteBook 845 G7', qty: 50 }], ...over })
const inv = (over = {}) => ({ id: 'i-1', ref: 'INV/2026/0010', type: 'customer_invoice', saleOrderId: 'so-4', status: 'posted', total: 2250000, date: '2026-02-01', ...over })

describe('invoiced but not delivered', () => {
  it('lists machines billed with no validated delivery', () => {
    const rows = findInvoicedNotDelivered({ saleOrders: [so()], invoices: [inv()], deliveries: [], products })
    expect(rows).toEqual([expect.objectContaining({ ref: 'SO/2026/0004', undelivered: 50, invoiceRefs: ['INV/2026/0010'] })])
  })

  it('counts only what the validated deliveries have not covered', () => {
    const deliveries = [{ saleOrderId: 'so-4', status: 'done', lines: [{ productId: 'p-845', qty: 30, qtyDone: 30 }] }]
    expect(findInvoicedNotDelivered({ saleOrders: [so()], invoices: [inv()], deliveries, products })[0].undelivered).toBe(20)
    const all = [{ saleOrderId: 'so-4', status: 'done', lines: [{ productId: 'p-845', qty: 50, qtyDone: 50 }] }]
    expect(findInvoicedNotDelivered({ saleOrders: [so()], invoices: [inv()], deliveries: all, products })).toEqual([])
  })

  it('ignores services, drafts, deposits and cancelled orders', () => {
    const service = so({ lines: [{ productId: 'p-fee', qty: 1 }] })
    expect(findInvoicedNotDelivered({ saleOrders: [service], invoices: [inv()], deliveries: [], products })).toEqual([])
    expect(findInvoicedNotDelivered({ saleOrders: [so()], invoices: [inv({ status: 'draft' })], deliveries: [], products })).toEqual([])
    expect(findInvoicedNotDelivered({ saleOrders: [so()], invoices: [inv({ isDownPayment: true })], deliveries: [], products })).toEqual([])
    expect(findInvoicedNotDelivered({ saleOrders: [so({ status: 'cancelled' })], invoices: [inv()], deliveries: [], products })).toEqual([])
  })
})
