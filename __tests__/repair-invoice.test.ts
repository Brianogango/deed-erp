import { describe, it, expect } from 'vitest'
import {
  buildRepairInvoiceCharges,
  executionChargeTotal,
  invoiceMatchesRepairCharges,
  repairBillingNeedsSync,
  repairInvoiceChargeTotal,
} from '@/lib/repair-invoice'

describe('buildRepairInvoiceCharges', () => {
  it('bills the approved quote even when parts were also logged', () => {
    const lines = buildRepairInvoiceCharges({
      partsUsed: [{ productName: 'SSD 256GB', qty: 1, price: 4000 }],
      laborCost: 1500,
      quote: {
        lines: [
          { type: 'part', description: 'SSD 256GB', qty: 1, unitPrice: 4000, subtotal: 4000 },
          { type: 'labor', description: 'Labour', qty: 1, unitPrice: 1500, subtotal: 1500 },
          { type: 'software', description: 'Windows licence', qty: 1, unitPrice: 2500, subtotal: 2500 },
        ],
      },
      diagnosisFeeStatus: 'not_applicable',
    })
    expect(lines.map(l => l.description)).toEqual([
      '[PART] SSD 256GB',
      '[LABOR] Labour',
      '[SOFTWARE] Windows licence',
    ])
    expect(repairInvoiceChargeTotal(lines)).toBe(8000)
  })

  it('falls back to logged parts when there is no quote (Mercy / empty-quote path)', () => {
    const lines = buildRepairInvoiceCharges({
      partsUsed: [{ productName: 'SSD 256GB', qty: 1, price: 4000 }],
      laborCost: 1500,
      quote: { lines: [] },
      diagnosisFeeStatus: 'not_applicable',
    })
    expect(lines.map(l => l.description)).toEqual(['Part: SSD 256GB', 'Labor & Service Charges'])
    expect(repairInvoiceChargeTotal(lines)).toBe(5500)
  })

  it('uses the repair quote when labour/parts were never logged (REP/0283)', () => {
    const lines = buildRepairInvoiceCharges({
      partsUsed: [],
      laborCost: 0,
      logisticsCost: 0,
      diagnosisFee: 0,
      diagnosisFeeStatus: 'not_applicable',
      quote: {
        lines: [
          { type: 'service', description: 'Service', qty: 1, unitPrice: 1500, subtotal: 1500 },
          { type: 'part', description: 'Hardrive 500 GB', qty: 1, unitPrice: 3500, subtotal: 3500 },
        ],
      },
    }, true, 16)
    expect(executionChargeTotal({ partsUsed: [], laborCost: 0 })).toBe(0)
    expect(lines).toHaveLength(2)
    expect(repairInvoiceChargeTotal(lines)).toBe(5000)
    expect(lines.every(l => l.taxRate === 0)).toBe(true)
  })

  it('skips declined quote lines and already-paid diagnosis fees', () => {
    const lines = buildRepairInvoiceCharges({
      laborCost: 0,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'paid',
      diagnosisFeePaidAt: '2026-08-20',
      quote: {
        lines: [
          { type: 'service', description: 'Labour', qty: 1, unitPrice: 2000, decision: 'approved' },
          { type: 'part', description: 'Screen', qty: 1, unitPrice: 8000, decision: 'declined' },
        ],
      },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].description).toBe('[SERVICE] Labour')
    expect(repairInvoiceChargeTotal(lines)).toBe(2000)
  })
})

describe('invoiceMatchesRepairCharges', () => {
  const charges = buildRepairInvoiceCharges({
    quote: {
      lines: [
        { type: 'part', description: 'SSD', qty: 1, unitPrice: 4000, subtotal: 4000 },
        { type: 'labor', description: 'Labour', qty: 1, unitPrice: 2500, subtotal: 2500 },
      ],
    },
    diagnosisFeeStatus: 'not_applicable',
  })

  it('detects a thinner parts-only invoice', () => {
    expect(invoiceMatchesRepairCharges({
      total: 4000,
      lines: [{ qty: 1, unitPrice: 4000, subtotal: 4000, description: 'Part: SSD' }],
    }, charges)).toBe(false)
  })

  it('matches when qty, price, and total agree', () => {
    expect(invoiceMatchesRepairCharges({
      total: 6500,
      lines: [
        { qty: 1, unitPrice: 4000, subtotal: 4000 },
        { qty: 1, unitPrice: 2500, subtotal: 2500 },
      ],
    }, charges)).toBe(true)
  })
})

describe('repairBillingNeedsSync', () => {
  const charges = buildRepairInvoiceCharges({
    quote: { lines: [{ type: 'labor', description: 'Labour', qty: 1, unitPrice: 2000, subtotal: 2000 }] },
    diagnosisFeeStatus: 'not_applicable',
  })

  it('needs sync when the sale order is still a quotation (REP/0310)', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'sent',
      saleOrderStatus: 'quotation',
      invoice: { total: 2000, amountPaid: 0, lines: [{ qty: 1, unitPrice: 2000, subtotal: 2000 }] },
      charges,
    })
    expect(state.needed).toBe(true)
    expect(state.quoteOpen).toBe(true)
    expect(state.saleOrderOpen).toBe(true)
  })

  it('needs a rewrite when an unpaid invoice dropped quote lines', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'sent',
      saleOrderStatus: 'quotation',
      invoice: { total: 500, amountPaid: 0, lines: [{ qty: 1, unitPrice: 500, subtotal: 500 }] },
      charges,
    })
    expect(state.canRewriteInvoice).toBe(true)
    expect(state.needed).toBe(true)
  })

  it('does not rewrite a paid mismatch', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'accepted',
      saleOrderStatus: 'sale',
      invoice: { total: 500, amountPaid: 500, lines: [{ qty: 1, unitPrice: 500, subtotal: 500 }] },
      charges,
    })
    expect(state.canRewriteInvoice).toBe(false)
    expect(state.needed).toBe(false)
  })

  it('is done when quote, sale order, and invoice already match', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'accepted',
      saleOrderStatus: 'sale',
      invoice: { total: 2000, amountPaid: 0, status: 'posted', lines: [{ qty: 1, unitPrice: 2000, subtotal: 2000 }] },
      charges,
    })
    expect(state.needed).toBe(false)
    expect(state.matchesInvoice).toBe(true)
  })
})
