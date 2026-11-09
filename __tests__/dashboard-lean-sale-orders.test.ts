import { describe, expect, it } from 'vitest'
import { leanSaleOrders } from '@/lib/dashboard/lean-sale-orders'
import { saleOrderInvoiceStatus } from '@/lib/odoo-sales-flow'

describe('lean dashboard sale orders', () => {
  const full = {
    id: 'so1', ref: 'SO/1', status: 'sale', date: '2026-11-01', total: 5000, customerId: 'c1', customerName: 'Acme',
    salespersonId: 'u1', salespersonName: 'Rep', createdByUserId: 'u2', createdByName: 'Maker', confirmedAt: '2026-11-02', validUntil: '2026-11-30',
    notes: 'long notes', terms: 'long terms', history: [{ a: 1 }],
    lines: [{ id: 'l1', productId: 'p1', productName: 'HP', description: 'very long spec', qty: 2, qtyDelivered: 1, qtyInvoiced: 1, invoicePolicy: 'order', subtotal: 5000, serials: ['x'] }],
  }

  it('keeps the fields the dashboard reads and drops the rest', () => {
    const [lean] = leanSaleOrders([full])
    expect(lean).toEqual({
      id: 'so1', ref: 'SO/1', status: 'sale', date: '2026-11-01', total: 5000, customerId: 'c1', customerName: 'Acme',
      salespersonId: 'u1', salespersonName: 'Rep', createdByUserId: 'u2', createdByName: 'Maker', confirmedAt: '2026-11-02', validUntil: '2026-11-30',
      lines: [{ productId: 'p1', productName: 'HP', qty: 2, qtyDelivered: 1, qtyInvoiced: 1, invoicePolicy: 'order', subtotal: 5000 }],
    })
  })

  it('gives the same invoicing status as the full row', () => {
    const [lean] = leanSaleOrders([full])
    expect(saleOrderInvoiceStatus(lean.status, lean.lines)).toBe(saleOrderInvoiceStatus(full.status as never, full.lines as never))
  })

  it('ignores junk', () => {
    expect(leanSaleOrders(null)).toEqual([])
    expect(leanSaleOrders([null, 3, { id: 'a' }])).toEqual([{ id: 'a', lines: [] }])
  })
})
