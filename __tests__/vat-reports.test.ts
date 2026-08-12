import { describe, expect, it } from 'vitest'
import {
  buildVatControlFromAggregates,
  buildVatControlFromInvoices,
  buildVatReturnDraft,
  inputVatAccountCode,
  outputVatAccountCode,
} from '@/lib/accounting/vat-reports'

describe('VAT account codes', () => {
  it('maps to live CoA roles', () => {
    expect(outputVatAccountCode()).toBe('3301')
    expect(inputVatAccountCode()).toBe('1150')
  })
})

describe('buildVatControlFromAggregates', () => {
  it('computes output − input from journal nets', () => {
    const control = buildVatControlFromAggregates(new Map([
      ['3301', { code: '3301', debit: 160, credit: 1160 }],
      ['1150', { code: '1150', debit: 320, credit: 0 }],
    ]), { dateFrom: '2026-01-01', dateTo: '2026-03-31' })
    expect(control.outputVat).toBe(1000) // 1160 - 160 (credit note reverse)
    expect(control.inputVat).toBe(320)
    expect(control.vatPayable).toBe(680)
    expect(control.source).toBe('gl')
  })

  it('handles missing VAT accounts as zero', () => {
    const control = buildVatControlFromAggregates([])
    expect(control.outputVat).toBe(0)
    expect(control.inputVat).toBe(0)
    expect(control.vatPayable).toBe(0)
  })
})

describe('buildVatControlFromInvoices', () => {
  it('sums tax on posted customer and vendor docs', () => {
    const control = buildVatControlFromInvoices([
      { type: 'customer_invoice', status: 'posted', taxTotal: 160, subtotal: 1000 },
      { type: 'vendor_bill', status: 'posted', taxTotal: 80, subtotal: 500 },
      { type: 'customer_invoice', status: 'draft', taxTotal: 999, subtotal: 9999 },
    ])
    expect(control.outputVat).toBe(160)
    expect(control.inputVat).toBe(80)
    expect(control.vatPayable).toBe(80)
    expect(control.taxableSales).toBe(1000)
    expect(control.taxablePurchases).toBe(500)
    expect(control.source).toBe('invoices')
  })
})

describe('buildVatReturnDraft', () => {
  it('shapes a simple return draft DTO', () => {
    const control = buildVatControlFromAggregates(new Map([
      ['3301', { code: '3301', debit: 0, credit: 160 }],
      ['1150', { code: '1150', debit: 40, credit: 0 }],
    ]))
    const draft = buildVatReturnDraft(control, {
      periodLabel: 'Q1 2026',
      companyPin: 'P000000000X',
    })
    expect(draft.periodLabel).toBe('Q1 2026')
    expect(draft.boxes).toHaveLength(3)
    expect(draft.netPayable).toBe(120)
    expect(draft.companyPin).toBe('P000000000X')
  })
})
