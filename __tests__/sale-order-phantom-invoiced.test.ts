import { describe, it, expect } from 'vitest'
import { reconcileInvoicedQty, invoiceableQty, saleOrderInvoiceStatus } from '@/lib/odoo-sales-flow'

/**
 * REGRESSION 24-Sep-2026 — SO/2026/0190 read "Fully Delivered · Fully
 * Invoiced" while its Invoices panel said "None yet". An invoice attempt had
 * raised qtyInvoiced and then failed, so every line looked fully billed:
 * Create invoice was never offered again and the order could not be billed.
 */
const line = (over: Record<string, unknown> = {}) => ({
  qty: 1, qtyDelivered: 1, qtyInvoiced: 1, invoicePolicy: 'delivery' as const, ...over,
})

describe('an invoiced quantity that no invoice backs', () => {
  it('is ignored when the order has no live invoice', () => {
    const [fixed] = reconcileInvoicedQty([line()], 0)
    expect(fixed.qtyInvoiced).toBe(0)
    expect(invoiceableQty(fixed)).toBe(1)
  })

  it('unblocks the order: To Invoice instead of Fully Invoiced', () => {
    expect(saleOrderInvoiceStatus('sale', [line()])).toBe('invoiced')
    expect(saleOrderInvoiceStatus('sale', reconcileInvoicedQty([line()], 0))).toBe('to_invoice')
  })

  it('leaves counters alone once a real invoice exists', () => {
    const lines = [line(), line({ qty: 4, qtyDelivered: 4, qtyInvoiced: 2 })]
    expect(reconcileInvoicedQty(lines, 1)).toEqual(lines)
    // a part-invoiced order keeps its remaining balance
    expect(invoiceableQty(reconcileInvoicedQty(lines, 1)[1])).toBe(2)
  })

  it('touches nothing when the counters were already zero', () => {
    const lines = [line({ qtyInvoiced: 0 })]
    expect(reconcileInvoicedQty(lines, 0)).toEqual(lines)
  })
})
