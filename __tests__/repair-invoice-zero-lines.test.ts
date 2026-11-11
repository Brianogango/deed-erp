/**
 * INV/2026/0409: the quote had a free "Installation and transfer of data"
 * line. The invoice carried it at 0.00, the expected charges leave free lines
 * out, so the line counts differed (4 vs 3) and a matching invoice was
 * reported as out of step with its quote — blocking the job. The approved
 * diagnosis fee on the quote was dropped from the expected charges too when
 * the fee policy did not cover the job.
 */
import { describe, expect, it } from 'vitest'
import { buildRepairInvoiceCharges, invoiceMatchesRepairCharges, repairBillingNeedsSync } from '@/lib/repair-invoice'

const repair = {
  status: 'ready',
  intakeDate: '2026-11-03T08:00:00.000Z',
  // Straight to repair: the fee policy alone would not add a fee, but the
  // customer approved one on the quote, so it is billed.
  repairPath: 'direct_repair',
  diagnosisFee: 1000,
  diagnosisFeeStatus: 'applicable',
  quote: {
    tax: 0,
    lines: [
      { type: 'service', description: 'Diagnosis Fee', qty: 1, unitPrice: 1000, subtotal: 1000, decision: 'approved', isDiagnosisFee: true },
      { type: 'part', description: '512GB NVMe SSD - M.2 2280 PCIe', qty: 1, unitPrice: 8500, subtotal: 8500, decision: 'approved' },
      { type: 'part', description: '16GB DDR4 SODIMM Laptop RAM - 3200MHz', qty: 1, unitPrice: 8500, subtotal: 8500, decision: 'approved' },
      { type: 'labor', description: 'Installation and transfer of data', qty: 1, unitPrice: 0, subtotal: 0, decision: 'approved' },
    ],
  },
}

const invoice = {
  status: 'approved',
  total: 18000,
  amountPaid: 0,
  lines: [
    { description: 'Diagnosis Fee', qty: 1, unitPrice: 1000, subtotal: 1000 },
    { description: '512GB NVMe SSD - M.2 2280 PCIe', qty: 1, unitPrice: 8500, subtotal: 8500 },
    { description: '16GB DDR4 SODIMM Laptop RAM - 3200MHz', qty: 1, unitPrice: 8500, subtotal: 8500 },
    { description: 'Installation and transfer of data', qty: 1, unitPrice: 0, subtotal: 0 },
  ],
}

describe('repair invoice matching', () => {
  it('a free line on the invoice is not a difference', () => {
    const charges = buildRepairInvoiceCharges(repair, true, 16)
    expect(invoiceMatchesRepairCharges(invoice, charges)).toBe(true)
    expect(repairBillingNeedsSync({ invoice, charges }).requiresCreditNote).toBe(false)
  })

  it('a real difference still shows', () => {
    const charges = buildRepairInvoiceCharges(repair, true, 16)
    const changed = { ...invoice, total: 17000, lines: invoice.lines.map(l => l.unitPrice === 1000 ? { ...l, unitPrice: 0, subtotal: 0 } : l) }
    expect(invoiceMatchesRepairCharges(changed, charges)).toBe(false)
    expect(repairBillingNeedsSync({ invoice: changed, charges }).requiresCreditNote).toBe(true)
  })
})
