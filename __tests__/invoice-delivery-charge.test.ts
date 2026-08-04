import { describe, it, expect } from 'vitest'
import {
  appendDeliveryChargeToInvoice,
  buildDeliveryChargeInvoiceLine,
  recomputeInvoiceMoney,
} from '@/lib/invoice-delivery-charge'

describe('buildDeliveryChargeInvoiceLine', () => {
  it('builds a Delivery charge line with VAT rate', () => {
    expect(buildDeliveryChargeInvoiceLine({ id: 'l1', amount: 500, taxRate: 16 })).toEqual({
      id: 'l1',
      description: 'Delivery charge',
      qty: 1,
      unitPrice: 500,
      taxRate: 16,
      subtotal: 500,
    })
  })
})

describe('appendDeliveryChargeToInvoice', () => {
  it('appends the line and recomputes invoice totals with VAT', () => {
    const existing = [{
      id: 'a',
      description: 'Laptop',
      qty: 1,
      unitPrice: 10000,
      taxRate: 16,
      subtotal: 10000,
    }]
    const charge = buildDeliveryChargeInvoiceLine({ id: 'd', amount: 500, taxRate: 16 })
    const next = appendDeliveryChargeToInvoice({ lines: existing }, charge)
    expect(next.lines).toHaveLength(2)
    expect(next.lines[1].description).toBe('Delivery charge')
    expect(next.subtotal).toBe(10500)
    expect(next.taxTotal).toBe(Math.round(10000 * 0.16) + Math.round(500 * 0.16))
    expect(next.total).toBe(next.subtotal + next.taxTotal)
  })
})

describe('recomputeInvoiceMoney', () => {
  it('ignores section rows', () => {
    expect(recomputeInvoiceMoney([
      { id: 's', lineType: 'section', description: 'Hardware', qty: 0, unitPrice: 0, taxRate: 0, subtotal: 0 },
      { id: 'i', description: 'Item', qty: 1, unitPrice: 100, taxRate: 0, subtotal: 100 },
    ])).toEqual({ subtotal: 100, taxTotal: 0, total: 100 })
  })
})
