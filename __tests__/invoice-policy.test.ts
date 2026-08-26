import { describe, expect, it } from 'vitest'
import { resolveInvoicePolicy } from '@/lib/sales/invoice-policy'
import {
  invoiceableQty,
  saleOrderFulfilmentStatus,
  saleOrderIsAccepted,
  saleOrderIsOperationallyComplete,
} from '@/lib/odoo-sales-flow'

describe('resolveInvoicePolicy', () => {
  it('prefers explicit line policy', () => {
    expect(resolveInvoicePolicy({
      linePolicy: 'order',
      productPolicy: 'delivery',
      productUnit: 'unit',
    })).toBe('order')
  })

  it('defaults stockable products to delivery and services to order', () => {
    expect(resolveInvoicePolicy({ productUnit: 'unit' })).toBe('delivery')
    expect(resolveInvoicePolicy({ productUnit: 'service' })).toBe('order')
    expect(resolveInvoicePolicy({ trackStock: false })).toBe('order')
    expect(resolveInvoicePolicy({ trackStock: true })).toBe('delivery')
    expect(resolveInvoicePolicy({ productId: null })).toBe('order')
    expect(resolveInvoicePolicy({})).toBe('order')
  })
})

describe('invoiceableQty with policies', () => {
  it('allows ordered-policy invoicing before delivery', () => {
    expect(invoiceableQty({
      qty: 5,
      qtyDelivered: 0,
      qtyInvoiced: 0,
      invoicePolicy: 'order',
    })).toBe(5)
  })

  it('blocks delivered-policy invoicing until delivered', () => {
    expect(invoiceableQty({
      qty: 5,
      qtyDelivered: 0,
      qtyInvoiced: 0,
      invoicePolicy: 'delivery',
    })).toBe(0)
    expect(invoiceableQty({
      qty: 5,
      qtyDelivered: 2,
      qtyInvoiced: 0,
      invoicePolicy: 'delivery',
    })).toBe(2)
  })
})

describe('sale order fulfilment / completion', () => {
  it('tracks partial and full delivery independently of payment', () => {
    expect(saleOrderFulfilmentStatus('sale', [
      { qty: 10, qtyDelivered: 4 },
    ])).toBe('partial')
    expect(saleOrderFulfilmentStatus('sale', [
      { qty: 10, qtyDelivered: 10 },
    ])).toBe('delivered')
  })

  it('is operationally complete only when delivered and invoiced', () => {
    expect(saleOrderIsOperationallyComplete('sale', [
      { qty: 2, qtyDelivered: 2, qtyInvoiced: 1, invoicePolicy: 'delivery' },
    ])).toBe(false)
    expect(saleOrderIsOperationallyComplete('sale', [
      { qty: 2, qtyDelivered: 2, qtyInvoiced: 2, invoicePolicy: 'delivery' },
    ])).toBe(true)
  })
})

describe('saleOrderIsAccepted', () => {
  it('detects acceptedAt or acceptance note', () => {
    expect(saleOrderIsAccepted({ acceptedAt: '2026-08-08T00:00:00.000Z' })).toBe(true)
    expect(saleOrderIsAccepted({ notes: '[Customer accepted 2026-08-08]' })).toBe(true)
    expect(saleOrderIsAccepted({ notes: 'plain note' })).toBe(false)
  })
})
