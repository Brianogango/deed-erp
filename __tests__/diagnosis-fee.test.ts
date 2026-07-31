import { describe, it, expect } from 'vitest'
import {
  buildDiagnosisFeeQuoteLine,
  diagnosisFeeAmountForTier,
  ensureDiagnosisFeeInQuoteLines,
  isDiagnosisFeeLine,
  resolveDiagnosisFee,
  shouldChargeDiagnosisFee,
  taxableQuoteSubtotal,
} from '@/lib/diagnosis-fee'

describe('diagnosis-fee', () => {
  it('resolves regular and high-end amounts from settings', () => {
    expect(diagnosisFeeAmountForTier('regular', {})).toBe(1500)
    expect(diagnosisFeeAmountForTier('high_end', {})).toBe(2500)
    expect(diagnosisFeeAmountForTier('high_end', { diagnosisFeeHighEndKes: 3000 })).toBe(3000)
  })

  it('does not charge Direct Repair or waived / full warranty', () => {
    expect(shouldChargeDiagnosisFee({ repairPath: 'direct_repair', deviceTier: 'regular' })).toBe(false)
    expect(shouldChargeDiagnosisFee({ repairPath: 'diagnosis_first', diagnosisFeeStatus: 'waived' })).toBe(false)
    expect(shouldChargeDiagnosisFee({
      repairPath: 'diagnosis_first',
      underWarranty: true,
      warrantyCoverage: 'full',
    })).toBe(false)
    expect(shouldChargeDiagnosisFee({ repairPath: 'diagnosis_first', deviceTier: 'regular' })).toBe(true)
  })

  it('resolveDiagnosisFee returns applicable amount for diagnosis_first', () => {
    expect(resolveDiagnosisFee({ repairPath: 'diagnosis_first', deviceTier: 'high_end' })).toEqual({
      amount: 2500,
      status: 'applicable',
      tier: 'high_end',
    })
    expect(resolveDiagnosisFee({ repairPath: 'direct_repair' }).status).toBe('not_applicable')
  })

  it('injects a locked fee line without replacing labor', () => {
    const lines = ensureDiagnosisFeeInQuoteLines(
      [{ type: 'labor', description: 'Labour', qty: 1, unitPrice: 5000, subtotal: 5000 }],
      1500,
      true,
    )
    expect(lines).toHaveLength(2)
    expect(isDiagnosisFeeLine(lines[0])).toBe(true)
    expect(lines[0].unitPrice).toBe(1500)
    expect(lines[1].description).toBe('Labour')
  })

  it('excludes diagnosis fee from taxable subtotal (0% VAT)', () => {
    const fee = buildDiagnosisFeeQuoteLine(2500)
    const labor = { type: 'labor', description: 'Labour', qty: 1, unitPrice: 5000, subtotal: 5000 }
    expect(taxableQuoteSubtotal([fee, labor])).toBe(5000)
  })
})
