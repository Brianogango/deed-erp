import { describe, it, expect } from 'vitest'
import {
  buildRepairInvoiceCharges,
  executionChargeTotal,
  repairInvoiceChargeTotal,
} from '@/lib/repair-invoice'

describe('buildRepairInvoiceCharges', () => {
  it('uses logged parts and labour when they have a total', () => {
    const lines = buildRepairInvoiceCharges({
      partsUsed: [{ productName: 'SSD 256GB', qty: 1, price: 4000 }],
      laborCost: 1500,
      quote: { lines: [{ description: 'Should not be used', qty: 1, unitPrice: 99, type: 'service' }] },
      diagnosisFeeStatus: 'not_applicable',
    })
    expect(lines.map(l => l.description)).toEqual(['Part: SSD 256GB', 'Labor & Service Charges'])
    expect(repairInvoiceChargeTotal(lines)).toBe(5500)
  })

  it('falls back to the repair quote when labour/parts were never logged (Mercy / REP/0283)', () => {
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
    expect(lines[0].description).toBe('Labour')
    expect(repairInvoiceChargeTotal(lines)).toBe(2000)
  })
})
