import { describe, it, expect } from 'vitest'
import {
  buildDiagnosisFeeQuoteLine,
  DEFAULT_DIAGNOSIS_FEE_KES,
  DIAGNOSIS_FEE_POLICY_EFFECTIVE_AT,
  diagnosisFeeAmount,
  diagnosisFeeAmountForTier,
  ensureDiagnosisFeeInQuoteLines,
  isDiagnosisFeeLine,
  isDiagnosisFeePolicyInEffect,
  isDiagnosisFeeSettled,
  mustCollectDiagnosisFeeUpfront,
  resolveCustomerBillingType,
  resolveDiagnosisFee,
  resolveDiagnosisFeeBilling,
  shouldChargeDiagnosisFee,
  taxableQuoteSubtotal,
} from '@/lib/diagnosis-fee'

const AFTER = '2026-08-03T15:00:00+03:00'
const JUST_BEFORE = '2026-08-03T14:59:59+03:00'
const EARLIER = '2026-08-02T10:00:00+03:00'

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

  it('bills fee on final invoice for walk-in and corporate', () => {
    expect(resolveDiagnosisFeeBilling('individual')).toBe('invoice')
    expect(resolveDiagnosisFeeBilling('company')).toBe('invoice')
    expect(resolveCustomerBillingType('individual')).toBe('walk_in')
    expect(resolveCustomerBillingType('company')).toBe('corporate')
  })

  it('applies only from 3 Aug 2026 3pm EAT based on intakeDate', () => {
    expect(DIAGNOSIS_FEE_POLICY_EFFECTIVE_AT).toBe('2026-08-03T15:00:00+03:00')
    expect(isDiagnosisFeePolicyInEffect(AFTER)).toBe(true)
    expect(isDiagnosisFeePolicyInEffect(JUST_BEFORE)).toBe(false)
    expect(isDiagnosisFeePolicyInEffect(EARLIER)).toBe(false)
    expect(isDiagnosisFeePolicyInEffect(undefined)).toBe(false)
    expect(isDiagnosisFeePolicyInEffect('')).toBe(false)
  })

  it('does not charge Direct Repair, waived, full warranty, or pre-policy jobs', () => {
    expect(shouldChargeDiagnosisFee({ repairPath: 'direct_repair', intakeDate: AFTER })).toBe(false)
    expect(shouldChargeDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      diagnosisFeeStatus: 'waived',
    })).toBe(false)
    expect(shouldChargeDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      underWarranty: true,
      warrantyCoverage: 'full',
    })).toBe(false)
    expect(shouldChargeDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: JUST_BEFORE,
    })).toBe(false)
    expect(shouldChargeDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: EARLIER,
    })).toBe(false)
    expect(shouldChargeDiagnosisFee({ repairPath: 'diagnosis_first', intakeDate: AFTER })).toBe(true)
  })

  it('resolveDiagnosisFee returns flat applicable amount only after policy start', () => {
    expect(resolveDiagnosisFee({ repairPath: 'diagnosis_first', intakeDate: AFTER })).toMatchObject({
      amount: 1000,
      status: 'applicable',
      billing: 'invoice',
      customerType: 'walk_in',
    })
    expect(resolveDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: JUST_BEFORE,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'applicable',
    })).toMatchObject({
      amount: 0,
      status: 'not_applicable',
    })
    expect(resolveDiagnosisFee({ repairPath: 'direct_repair', intakeDate: AFTER }).status).toBe('not_applicable')
    expect(resolveDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      customerBillingType: 'corporate',
    }).billing).toBe('invoice')
  })

  it('preserves paid/invoiced amounts on pre-policy jobs', () => {
    expect(resolveDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: EARLIER,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'paid',
    }).status).toBe('paid')
    expect(resolveDiagnosisFee({
      repairPath: 'diagnosis_first',
      intakeDate: EARLIER,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'invoiced',
    }).status).toBe('invoiced')
  })

  it('never gates diagnosis/start on unpaid fee (invoice settlement)', () => {
    expect(mustCollectDiagnosisFeeUpfront({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      diagnosisFeeBilling: 'upfront',
      diagnosisFeeStatus: 'applicable',
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
