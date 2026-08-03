import { describe, it, expect } from 'vitest'
import {
  buildDiagnosisFeeQuoteLine,
  DEFAULT_DIAGNOSIS_FEE_KES,
  diagnosisFeeAmount,
  diagnosisFeeAmountForTier,
  ensureDiagnosisFeeInQuoteLines,
  isDiagnosisFeeLine,
  isDiagnosisFeeSettled,
  mustCollectDiagnosisFeeUpfront,
  resolveCustomerBillingType,
  resolveDiagnosisFee,
  resolveDiagnosisFeeBilling,
  shouldChargeDiagnosisFee,
  taxableQuoteSubtotal,
} from '@/lib/diagnosis-fee'

describe('diagnosis-fee', () => {
  it('uses flat KES 1000 by default (tier ignored)', () => {
    expect(diagnosisFeeAmount({})).toBe(DEFAULT_DIAGNOSIS_FEE_KES)
    expect(diagnosisFeeAmount({ diagnosisFeeKes: 1000 })).toBe(1000)
    expect(diagnosisFeeAmountForTier('regular', {})).toBe(1000)
    expect(diagnosisFeeAmountForTier('high_end', {})).toBe(1000)
    expect(diagnosisFeeAmountForTier('high_end', { diagnosisFeeKes: 1200 })).toBe(1200)
    // Legacy regular amount used only when flat unset
    expect(diagnosisFeeAmount({ diagnosisFeeRegularKes: 900 })).toBe(900)
  })

  it('maps walk-in vs corporate billing timing', () => {
    expect(resolveDiagnosisFeeBilling('individual')).toBe('upfront')
    expect(resolveDiagnosisFeeBilling('company')).toBe('invoice')
    expect(resolveCustomerBillingType('individual')).toBe('walk_in')
    expect(resolveCustomerBillingType('company')).toBe('corporate')
  })

  it('does not charge Direct Repair (declined diagnosis) or waived / full warranty', () => {
    expect(shouldChargeDiagnosisFee({ repairPath: 'direct_repair' })).toBe(false)
    expect(shouldChargeDiagnosisFee({ repairPath: 'diagnosis_first', diagnosisFeeStatus: 'waived' })).toBe(false)
    expect(shouldChargeDiagnosisFee({
      repairPath: 'diagnosis_first',
      underWarranty: true,
      warrantyCoverage: 'full',
    })).toBe(false)
    expect(shouldChargeDiagnosisFee({ repairPath: 'diagnosis_first' })).toBe(true)
  })

  it('resolveDiagnosisFee returns flat applicable amount for diagnosis_first', () => {
    expect(resolveDiagnosisFee({ repairPath: 'diagnosis_first' })).toMatchObject({
      amount: 1000,
      status: 'applicable',
      billing: 'upfront',
      customerType: 'walk_in',
    })
    expect(resolveDiagnosisFee({ repairPath: 'direct_repair' }).status).toBe('not_applicable')
    expect(resolveDiagnosisFee({
      repairPath: 'diagnosis_first',
      customerBillingType: 'corporate',
    }).billing).toBe('invoice')
  })

  it('requires upfront collection for unpaid walk-in only', () => {
    expect(mustCollectDiagnosisFeeUpfront({
      repairPath: 'diagnosis_first',
      diagnosisFeeBilling: 'upfront',
      diagnosisFeeStatus: 'applicable',
    })).toBe(true)
    expect(mustCollectDiagnosisFeeUpfront({
      repairPath: 'diagnosis_first',
      diagnosisFeeBilling: 'invoice',
      customerBillingType: 'corporate',
      diagnosisFeeStatus: 'applicable',
    })).toBe(false)
    expect(mustCollectDiagnosisFeeUpfront({
      repairPath: 'diagnosis_first',
      diagnosisFeeBilling: 'upfront',
      diagnosisFeeStatus: 'paid',
    })).toBe(false)
    expect(mustCollectDiagnosisFeeUpfront({ repairPath: 'direct_repair' })).toBe(false)
  })

  it('treats paid / invoiced as settled', () => {
    expect(isDiagnosisFeeSettled({ diagnosisFeeStatus: 'paid' })).toBe(true)
    expect(isDiagnosisFeeSettled({ diagnosisFeeStatus: 'invoiced' })).toBe(true)
    expect(isDiagnosisFeeSettled({ diagnosisFeePaidAt: '2026-08-01' })).toBe(true)
    expect(isDiagnosisFeeSettled({ diagnosisFeeStatus: 'applicable' })).toBe(false)
  })

  it('injects a locked fee line without replacing labor (fee never credited against labour)', () => {
    const lines = ensureDiagnosisFeeInQuoteLines(
      [{ type: 'labor', description: 'Labour', qty: 1, unitPrice: 5000, subtotal: 5000 }],
      1000,
      true,
    )
    expect(lines).toHaveLength(2)
    expect(isDiagnosisFeeLine(lines[0])).toBe(true)
    expect(lines[0].unitPrice).toBe(1000)
    expect(lines[1].description).toBe('Labour')
    expect(lines[1].unitPrice).toBe(5000)
  })

  it('excludes diagnosis fee from taxable subtotal (0% VAT)', () => {
    const fee = buildDiagnosisFeeQuoteLine(1000)
    const labor = { type: 'labor', description: 'Labour', qty: 1, unitPrice: 5000, subtotal: 5000 }
    expect(taxableQuoteSubtotal([fee, labor])).toBe(5000)
  })
})
