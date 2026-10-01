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

  it('needs a rewrite when an unpaid DRAFT invoice dropped quote lines', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'sent',
      saleOrderStatus: 'quotation',
      invoice: { status: 'draft', total: 500, amountPaid: 0, lines: [{ qty: 1, unitPrice: 500, subtotal: 500 }] },
      charges,
    })
    expect(state.canRewriteInvoice).toBe(true)
    expect(state.requiresCreditNote).toBe(false)
    expect(state.needed).toBe(true)
  })

  it('does not rewrite a paid mismatch, and calls for a credit note instead', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'accepted',
      saleOrderStatus: 'sale',
      invoice: { status: 'paid', total: 500, amountPaid: 500, lines: [{ qty: 1, unitPrice: 500, subtotal: 500 }] },
      charges,
    })
    expect(state.canRewriteInvoice).toBe(false)
    // The discrepancy is real and still worth surfacing — what changed is the
    // remedy offered, not whether the repair is flagged.
    expect(state.requiresCreditNote).toBe(true)
    expect(state.needed).toBe(true)
  })

  it('will not offer to rewrite a POSTED invoice that nobody has paid (REP-499EXM5H)', () => {
    // The bug this covers. canRewriteInvoice asked only whether anything had
    // been paid, so a posted invoice billed on credit — nothing paid against it
    // yet — was offered an "Align invoice with quote" button, and the server
    // answered "posted and immutable — issue a credit/debit note". The UI was
    // proposing an action that could never succeed. Posting freezes a document;
    // payment is a separate question.
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'accepted',
      saleOrderStatus: 'sale',
      invoice: { status: 'posted', total: 500, amountPaid: 0, lines: [{ qty: 1, unitPrice: 500, subtotal: 500 }] },
      charges,
    })
    expect(state.canRewriteInvoice).toBe(false)
    expect(state.requiresCreditNote).toBe(true)
    expect(state.needed).toBe(true)
  })

  it('leaves a posted invoice alone when it already matches the quote', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'accepted',
      saleOrderStatus: 'sale',
      invoice: { status: 'posted', total: 2000, amountPaid: 0, lines: [{ qty: 1, unitPrice: 2000, subtotal: 2000 }] },
      charges,
    })
    expect(state.requiresCreditNote).toBe(false)
    expect(state.needed).toBe(false)
  })

  it('treats a cancelled invoice as missing, not as needing a credit note', () => {
    const state = repairBillingNeedsSync({
      salesQuoteStatus: 'accepted',
      saleOrderStatus: 'sale',
      invoice: { status: 'cancelled', total: 500, amountPaid: 0, lines: [{ qty: 1, unitPrice: 500, subtotal: 500 }] },
      charges,
    })
    expect(state.missingInvoice).toBe(true)
    expect(state.requiresCreditNote).toBe(false)
    expect(state.canRewriteInvoice).toBe(false)
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

describe('VAT is read from the quote, not recomputed from a hardcoded rule (REP-499EXM5H)', () => {
  // The real repair. 3,000 labour + a 1,000 diagnosis fee, VAT 480 on the
  // labour, invoiced at 4,480. The charge recomputation used to tax only
  // part/software/license, so labour came back at 0 VAT, the job recomputed as
  // 4,000, and the correctly-billed 4,480 invoice was reported as out of step
  // with its own quote — permanently.
  const repair = {
    // Booked 24 Sept 2026 on the diagnosis-first path, which is what makes the
    // diagnosis fee billable at all.
    intakeDate: '2026-09-24',
    repairPath: 'diagnosis_first' as const,
    diagnosisFee: 1000,
    diagnosisFeeStatus: 'applicable' as const,
    underWarranty: false,
    quote: {
      subtotal: 4000,
      tax: 480,
      total: 4480,
      lines: [
        { type: 'service', description: 'Diagnosis Fee', qty: 1, unitPrice: 1000, subtotal: 1000, isDiagnosisFee: true, decision: 'approved' },
        { type: 'labor', description: 'Power issue fix', qty: 1, unitPrice: 3000, subtotal: 3000, decision: 'approved' },
      ],
    },
  }

  it('reproduces the invoiced total exactly', () => {
    const charges = buildRepairInvoiceCharges(repair as never, true, 16)
    expect(repairInvoiceChargeTotal(charges)).toBe(4480)
  })

  it('recognises the invoice that billed it as matching', () => {
    const charges = buildRepairInvoiceCharges(repair as never, true, 16)
    const invoice = {
      total: 4480,
      lines: [
        { qty: 1, unitPrice: 1000, subtotal: 1000 },
        { qty: 1, unitPrice: 3000, subtotal: 3000 },
      ],
    }
    expect(invoiceMatchesRepairCharges(invoice, charges)).toBe(true)
  })

  it('does not depend on the company VAT rate being loaded', () => {
    // components pass `companySettings?.vatRate ?? 0`, so an unloaded setting
    // used to zero the tax and break the comparison a second way.
    const charges = buildRepairInvoiceCharges(repair as never, true, 0)
    expect(repairInvoiceChargeTotal(charges)).toBe(4480)
  })

  it('still charges nothing on a quote that carried no VAT', () => {
    const noVat = { ...repair, quote: { ...repair.quote, tax: 0, total: 4000 } }
    const charges = buildRepairInvoiceCharges(noVat as never, true, 16)
    expect(repairInvoiceChargeTotal(charges)).toBe(4000)
  })

  it('leaves the diagnosis fee untaxed', () => {
    const charges = buildRepairInvoiceCharges(repair as never, true, 16)
    const fee = charges.find(c => c.description.includes('Diagnosis Fee'))
    expect(fee).toMatchObject({ subtotal: 1000, taxRate: 0 })
  })
})

describe('an unrepairable job bills the diagnosis fee only', () => {
  // Diagnosis-first, quoted at 3,000 and approved, repair attempted, device
  // could not be saved. Before this, `unrepairable` was in neither the
  // quotable nor the invoiceable status list, so the diagnosis fee could never
  // be charged once the job was marked — while the customer was told by SMS
  // that no charges applied.
  const base = {
    intakeDate: '2026-09-24',
    repairPath: 'diagnosis_first' as const,
    diagnosisFee: 1000,
    diagnosisFeeStatus: 'applicable' as const,
    underWarranty: false,
    laborCost: 2000,
    partsUsed: [{ productName: 'Mainboard', qty: 1, price: 8000 }],
    quote: {
      subtotal: 3000, tax: 0, total: 3000,
      lines: [{ type: 'labor', description: 'Power issue fix', qty: 1, unitPrice: 3000, subtotal: 3000, decision: 'approved' }],
    },
  }

  it('bills the fee and nothing else', () => {
    const charges = buildRepairInvoiceCharges({ ...base, status: 'unrepairable' } as never, true, 16)
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({ subtotal: 1000, taxRate: 0 })
    expect(repairInvoiceChargeTotal(charges)).toBe(1000)
  })

  it('does not bill the approved quote for a repair that did not work', () => {
    const charges = buildRepairInvoiceCharges({ ...base, status: 'unrepairable' } as never, true, 16)
    expect(charges.some(c => c.description.includes('Power issue fix'))).toBe(false)
  })

  it('does not fall back to parts and labour either', () => {
    const noQuote = { ...base, quote: null, status: 'unrepairable' }
    const charges = buildRepairInvoiceCharges(noQuote as never, true, 16)
    expect(charges).toHaveLength(1)
    expect(repairInvoiceChargeTotal(charges)).toBe(1000)
  })

  it('bills nothing when the fee was already settled', () => {
    const settled = { ...base, status: 'unrepairable', diagnosisFeeStatus: 'paid' as const }
    expect(buildRepairInvoiceCharges(settled as never, true, 16)).toEqual([])
  })

  it('bills nothing on a direct-repair job, which carries no diagnosis fee', () => {
    const direct = { ...base, status: 'unrepairable', repairPath: 'direct_repair' as const }
    expect(buildRepairInvoiceCharges(direct as never, true, 16)).toEqual([])
  })

  it('still bills the full quote while the job is not unrepairable', () => {
    const charges = buildRepairInvoiceCharges({ ...base, status: 'ready' } as never, true, 16)
    expect(repairInvoiceChargeTotal(charges)).toBe(4000)
  })
})

describe('declined quote', () => {
  const declined = {
    status: 'declined',
    intakeDate: '2026-09-24',
    repairPath: 'diagnosis_first' as const,
    quote: { lines: [{ type: 'labor', description: 'Labour', qty: 1, unitPrice: 3000, subtotal: 3000 }] },
    diagnosisFee: 1000,
    diagnosisFeeStatus: 'applicable',
  }

  it('bills only the diagnosis fee, never the declined quote', () => {
    const charges = buildRepairInvoiceCharges(declined as never, true, 16)
    expect(charges.map(c => c.description)).toEqual(['Diagnosis Fee (repair not undertaken)'])
    expect(repairInvoiceChargeTotal(charges)).toBe(1000)
  })

  it('bills nothing once the fee is paid or waived', () => {
    expect(buildRepairInvoiceCharges({ ...declined, diagnosisFeeStatus: 'paid' } as never, true, 16)).toEqual([])
    expect(buildRepairInvoiceCharges({ ...declined, diagnosisFeeStatus: 'waived' } as never, true, 16)).toEqual([])
  })
})
