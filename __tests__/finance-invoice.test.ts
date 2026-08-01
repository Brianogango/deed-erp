import { describe, it, expect } from 'vitest'
import {
  computeInvoiceTotals,
  computeInvoiceLineMoney,
  clampAmountPaid,
  mapDbInvoiceItemsToClientLines,
  preserveInvoiceLinesOnStoreWrite,
} from '@/lib/finance-invoice'

describe('computeInvoiceTotals', () => {
  it('derives subtotal from qty × unitPrice, ignoring client-supplied line subtotals', () => {
    const totals = computeInvoiceTotals([
      { qty: 2, unitPrice: 100, subtotal: 999999 },
      { qty: 1, unitPrice: 50, subtotal: 0 },
    ])
    expect(totals.subtotal).toBe(250)
    expect(totals.totalAmount).toBe(250)
  })

  it('computes per-line tax from tax rates', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 1000, taxRate: 16 }])
    expect(totals.subtotal).toBe(1000)
    expect(totals.taxAmount).toBe(160)
    expect(totals.totalAmount).toBe(1160)
  })

  it('applies per-line discount percent before tax', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 10000, discountPct: 10, taxRate: 16 }])
    expect(totals.subtotal).toBe(9000)
    expect(totals.discountAmount).toBe(1000)
    expect(totals.taxAmount).toBe(1440)
    expect(totals.totalAmount).toBe(10440)
  })

  it('falls back to header tax when lines carry no rate (POS/repair VAT pattern)', () => {
    const totals = computeInvoiceTotals(
      [{ qty: 1, unitPrice: 1000, taxRate: 0 }],
      { headerTax: 160 },
    )
    expect(totals.subtotal).toBe(1000)
    expect(totals.taxAmount).toBe(160)
    expect(totals.totalAmount).toBe(1160)
  })

  it('applies header discount when no line discount, and never returns a negative total', () => {
    const totals = computeInvoiceTotals([{ qty: 1, unitPrice: 100 }], { discount: 500 })
    expect(totals.totalAmount).toBe(0)
    expect(totals.discountAmount).toBe(500)
  })

  it('handles an empty / non-array line set safely', () => {
    expect(computeInvoiceTotals([]).totalAmount).toBe(0)
    // @ts-expect-error — defensive against malformed payloads
    expect(computeInvoiceTotals(undefined).totalAmount).toBe(0)
  })
})

describe('computeInvoiceLineMoney', () => {
  it('nets discount then taxes the net', () => {
    const line = computeInvoiceLineMoney({ qty: 2, unitPrice: 500, discountPct: 20, taxRate: 16 })
    expect(line.gross).toBe(1000)
    expect(line.discountAmount).toBe(200)
    expect(line.lineSubtotal).toBe(800)
    expect(line.lineTax).toBe(128)
    expect(line.lineTotal).toBe(928)
  })
})

describe('clampAmountPaid', () => {
  it('clamps into [0, totalAmount]', () => {
    expect(clampAmountPaid(999, 500)).toBe(500)
    expect(clampAmountPaid(-10, 500)).toBe(0)
    expect(clampAmountPaid(250, 500)).toBe(250)
  })
})

describe('mapDbInvoiceItemsToClientLines', () => {
  it('maps pretax lineSubtotal (not tax-inclusive lineTotal) and discountPct', () => {
    const lines = mapDbInvoiceItemsToClientLines([
      {
        id: 'li1',
        description: 'Laptop ×1',
        qty: 1,
        unitPrice: 10000,
        taxRate: 16,
        discountPct: 10,
        lineSubtotal: 9000,
        productId: 'p1',
      },
    ])
    expect(lines).toEqual([{
      id: 'li1',
      description: 'Laptop ×1',
      qty: 1,
      unitPrice: 10000,
      taxRate: 16,
      discountPct: 10,
      subtotal: 9000,
      productId: 'p1',
    }])
  })

  it('falls back to qty × unitPrice when lineSubtotal missing', () => {
    const lines = mapDbInvoiceItemsToClientLines([
      { description: 'Part', qty: 2, unitPrice: 500, taxRate: 0 },
    ])
    expect(lines[0].subtotal).toBe(1000)
    expect(lines[0].id).toBe('line-0')
  })
})

describe('preserveInvoiceLinesOnStoreWrite', () => {
  it('keeps existing lines when incoming shell has lines:[]', () => {
    const current = [{
      id: 'inv1',
      ref: 'INV/1',
      lines: [{ id: 'l1', description: 'Item', qty: 1, unitPrice: 100, taxRate: 0, subtotal: 100 }],
      subtotal: 100,
      taxTotal: 0,
      total: 100,
    }]
    const incoming = [{
      id: 'inv1',
      ref: 'INV/1',
      lines: [],
      subtotal: 116,
      taxTotal: 0,
      total: 116,
    }]
    const merged = preserveInvoiceLinesOnStoreWrite(current, incoming) as typeof current
    expect(merged[0].lines).toHaveLength(1)
    expect(merged[0].lines[0].description).toBe('Item')
    expect(merged[0].subtotal).toBe(100)
    expect(merged[0].total).toBe(100)
  })

  it('allows intentional non-empty line updates', () => {
    const current = [{ id: 'inv1', lines: [{ id: 'l1', subtotal: 100 }], subtotal: 100, total: 100 }]
    const incoming = [{ id: 'inv1', lines: [{ id: 'l2', subtotal: 200 }], subtotal: 200, total: 200 }]
    const merged = preserveInvoiceLinesOnStoreWrite(current, incoming) as typeof incoming
    expect(merged[0].lines[0].id).toBe('l2')
    expect(merged[0].subtotal).toBe(200)
  })
})
