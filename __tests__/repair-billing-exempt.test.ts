import { describe, it, expect } from 'vitest'
import {
  BILLING_EXEMPT_REASON_LABELS,
  billingExemptLabel,
  canApplyBillingExempt,
  canMarkRepairBillingExempt,
  isRepairBillingExempt,
  isRepairNoCharge,
  normalizeBillingExemptReason,
  startableStatusesWhenBillingExempt,
} from '@/lib/repair-billing-exempt'
import { resolveDiagnosisFee, shouldChargeDiagnosisFee } from '@/lib/diagnosis-fee'

describe('repair billing exempt helpers', () => {
  it('normalizes reason codes', () => {
    expect(normalizeBillingExemptReason('goodwill')).toBe('goodwill')
    expect(normalizeBillingExemptReason('other')).toBe('other')
    expect(normalizeBillingExemptReason('company_mistake')).toBe('company_mistake')
    expect(normalizeBillingExemptReason('weird')).toBe('company_mistake')
  })

  it('detects billing exempt and no-charge (incl. full warranty)', () => {
    expect(isRepairBillingExempt({ billingExempt: true })).toBe(true)
    expect(isRepairBillingExempt({ billingExempt: false })).toBe(false)
    expect(isRepairNoCharge({ billingExempt: true })).toBe(true)
    expect(isRepairNoCharge({ underWarranty: true, warrantyCoverage: 'full' })).toBe(true)
    expect(isRepairNoCharge({ underWarranty: true, warrantyCoverage: 'partial' })).toBe(false)
  })

  it('restricts mark action to managers on open jobs', () => {
    expect(canApplyBillingExempt('director')).toBe(true)
    expect(canApplyBillingExempt('technician')).toBe(false)
    expect(canMarkRepairBillingExempt('director', { status: 'diagnosed' })).toBe(true)
    expect(canMarkRepairBillingExempt('director', { status: 'diagnosed', billingExempt: true })).toBe(false)
    expect(canMarkRepairBillingExempt('director', { status: 'closed' })).toBe(false)
    expect(canMarkRepairBillingExempt('technician', { status: 'diagnosed' })).toBe(false)
  })

  it('allows start without quote approval when exempt', () => {
    const statuses = startableStatusesWhenBillingExempt()
    expect(statuses).toEqual(
      expect.arrayContaining(['assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'declined']),
    )
  })

  it('labels reasons for UI', () => {
    expect(BILLING_EXEMPT_REASON_LABELS.company_mistake).toMatch(/mistake/i)
    expect(billingExemptLabel({ billingExempt: true, billingExemptReason: 'goodwill' })).toBe(
      BILLING_EXEMPT_REASON_LABELS.goodwill,
    )
    expect(billingExemptLabel({ billingExempt: false })).toBe('')
  })
})

describe('diagnosis fee when billing exempt', () => {
  const postPolicy = { intakeDate: '2026-08-04T12:00:00+03:00', repairPath: 'diagnosis_first' as const }

  it('does not charge diagnosis fee on billing-exempt jobs', () => {
    expect(shouldChargeDiagnosisFee({ ...postPolicy, billingExempt: true })).toBe(false)
    expect(resolveDiagnosisFee({ ...postPolicy, billingExempt: true }).status).toBe('not_applicable')
    expect(resolveDiagnosisFee({ ...postPolicy, billingExempt: true }).amount).toBe(0)
  })

  it('still charges normal diagnosis-first jobs', () => {
    expect(shouldChargeDiagnosisFee(postPolicy)).toBe(true)
  })
})
