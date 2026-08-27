import { describe, expect, it } from 'vitest'
import { buildStatutoryVatReturn } from '@/lib/accounting/vat-tax-ledger'
import { buildCashFlowFromMovements } from '@/lib/accounting/cash-flow'
import { finalizeValuation } from '@/lib/inventory/valuation-hooks'

describe('statutory VAT from tax_transactions', () => {
  it('nets output, eligible input, and withholding', () => {
    const report = buildStatutoryVatReturn([
      { direction: 'output', taxAmount: 160, taxableBase: 1000, etimsInvoiceNo: 'INV1', transmissionStatus: 'pending' },
      { direction: 'output', taxAmount: -16, taxableBase: -100 },
      { direction: 'input', taxAmount: 32, taxableBase: 200, inputClaimEligible: true },
      { direction: 'input', taxAmount: 10, taxableBase: 50, inputClaimEligible: false },
      { direction: 'output', taxAmount: 0, taxableBase: 0, withholdingVat: 5 },
    ], { dateFrom: '2026-08-01', dateTo: '2026-08-31', taxPeriod: '2026-08' })
    expect(report.source).toBe('tax_transactions')
    expect(report.outputVat).toBe(144)
    expect(report.inputVat).toBe(32)
    expect(report.withholdingVat).toBe(5)
    expect(report.vatPayable).toBe(107)
    expect(report.etimsLinkedCount).toBe(1)
    expect(report.pendingTransmissionCount).toBe(1)
  })
})

describe('cash flow classification', () => {
  it('splits cash movements into operating / investing / financing', () => {
    const report = buildCashFlowFromMovements({
      dateFrom: '2026-01-01',
      dateTo: '2026-08-31',
      openingCash: 10000,
      cashMovements: [
        { accountCode: '2201', contraCode: '1800', contraName: 'AR', debit: 5000, credit: 0, entryId: '1' },
        { accountCode: '2201', contraCode: '1702', contraName: 'Furniture', debit: 0, credit: 2000, entryId: '2' },
        { accountCode: '2201', contraCode: '4001', contraName: 'Capital', debit: 3000, credit: 0, entryId: '3' },
      ],
    })
    expect(report.totalOperating).toBe(5000)
    expect(report.totalInvesting).toBe(-2000)
    expect(report.totalFinancing).toBe(3000)
    expect(report.netChange).toBe(6000)
    expect(report.closingCash).toBe(16000)
  })
})

describe('finalizeValuation', () => {
  it('fails closed on product_not_in_prisma and line errors', () => {
    const failed = finalizeValuation([
      { productId: 'a', result: { skipped: true, reason: 'product_not_in_prisma' } },
    ])
    expect(failed.ok).toBe(false)
    const okRetry = finalizeValuation([
      { productId: 'a', result: { skipped: true, reason: 'already_processed' } },
    ])
    expect(okRetry.ok).toBe(true)
    const lineError = finalizeValuation([{ productId: 'b', error: 'Insufficient FIFO layers' }])
    expect(lineError.ok).toBe(false)
  })
})
