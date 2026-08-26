import { describe, expect, it } from 'vitest'
import {
  isNonStockProduct,
  isNonStockSaleLine,
  isRepairNonStockQuoteType,
  saleLineFieldsForRepairQuoteLine,
} from '@/lib/sales/non-stock-line'
import { resolveInvoicePolicy } from '@/lib/sales/invoice-policy'
import { stockShortageLines } from '@/lib/sales/confirm-quotation'

describe('isNonStockSaleLine', () => {
  it('treats unlinked lines as non-stock (repair Service / free-text labour)', () => {
    expect(isNonStockSaleLine({ productName: 'Service', qty: 1 } as any)).toBe(true)
    expect(isNonStockSaleLine({ productId: '', productName: 'Hardrive 500 GB' })).toBe(true)
    expect(isNonStockSaleLine({ productId: null, productName: 'Service' })).toBe(true)
  })

  it('treats catalog services as non-stock even with a productId', () => {
    expect(isNonStockSaleLine(
      { productId: 'p-svc', productName: 'Device Diagnostic Service' },
      { unit: 'service', category: 'Services', trackStock: false },
    )).toBe(true)
    expect(isNonStockSaleLine(
      { productId: 'p-svc', unit: 'pcs' },
      { productKind: 'service', trackingMethod: 'NONE' },
    )).toBe(true)
  })

  it('keeps storable catalog products as stockable', () => {
    expect(isNonStockSaleLine(
      { productId: 'p-hdd', productName: '500GB SATA HDD' },
      { unit: 'pcs', category: 'Parts & Components', trackStock: true, trackingMethod: 'QUANTITY' },
    )).toBe(false)
    expect(isNonStockSaleLine({ productId: 'p-hdd', productName: '500GB SATA HDD' })).toBe(false)
  })

  it('treats a missing catalog product as non-stock', () => {
    expect(isNonStockSaleLine({ productId: 'gone' }, null)).toBe(true)
    expect(isNonStockProduct(null)).toBe(true)
  })
})

describe('resolveInvoicePolicy for services', () => {
  it('invoices unlinked and service lines from ordered qty', () => {
    expect(resolveInvoicePolicy({ productId: '' })).toBe('order')
    expect(resolveInvoicePolicy({ productId: null })).toBe('order')
    expect(resolveInvoicePolicy({ productKind: 'service', productId: 'p-svc' })).toBe('order')
    expect(resolveInvoicePolicy({ productUnit: 'service' })).toBe('order')
    expect(resolveInvoicePolicy({ trackStock: false })).toBe('order')
  })

  it('keeps stockable hardware on delivered quantities', () => {
    expect(resolveInvoicePolicy({
      productId: 'p-hdd',
      productUnit: 'pcs',
      trackStock: true,
    })).toBe('delivery')
  })
})

describe('stockShortageLines skips services', () => {
  it('does not warn on unlinked or service catalog lines', () => {
    const lines = [
      { productId: '', productName: 'Service', qty: 1 },
      { productId: 'p-svc', productName: 'Labour', qty: 1, unit: 'service' },
      { productId: 'p-hdd', productName: 'HDD', qty: 1 },
    ]
    const shortages = stockShortageLines(
      lines,
      id => (id === 'p-hdd' ? 0 : 99),
      line => isNonStockSaleLine(line),
    )
    expect(shortages).toEqual([{ productName: 'HDD', qty: 1, available: 0 }])
  })
})

describe('repair quote → sale line', () => {
  it('stamps labour/service as unit=service with ordered invoice policy', () => {
    expect(isRepairNonStockQuoteType('labor')).toBe(true)
    expect(isRepairNonStockQuoteType('part')).toBe(false)
    const service = saleLineFieldsForRepairQuoteLine({
      type: 'labor',
      description: 'Service',
      qty: 1,
      unitPrice: 1500,
      subtotal: 1500,
    })
    expect(service).toMatchObject({
      productId: '',
      productName: 'Service',
      unit: 'service',
      invoicePolicy: 'order',
      lineType: 'service',
    })
    const part = saleLineFieldsForRepairQuoteLine({
      type: 'part',
      productId: 'p-hdd',
      productName: '500GB SATA HDD',
      qty: 1,
      unitPrice: 3500,
      subtotal: 3500,
    })
    expect(part.unit).toBeUndefined()
    expect(part.invoicePolicy).toBeUndefined()
    expect(part.productId).toBe('p-hdd')
  })
})
