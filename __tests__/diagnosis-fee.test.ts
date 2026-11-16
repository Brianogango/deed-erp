import { describe, it, expect } from 'vitest'
import { diagnosisFeeExitPatch, diagnosisFeeListCell, buildDiagnosisFeeQuoteLine, DIAGNOSIS_FEE_POLICY_EFFECTIVE_AT, diagnosisFeeLineBadge, diagnosisFeeCustomerNotice, ensureDiagnosisFeeInQuoteLines, isDiagnosisFeeLine, portalDiagnosisFeeFields, isDiagnosisFeePolicyInEffect, isDiagnosisFeeSettled, resolveDiagnosisFee, shouldChargeDiagnosisFee, taxableQuoteSubtotal } from '@/lib/diagnosis-fee'

const AFTER = '2026-08-03T15:00:00+03:00'
const JUST_BEFORE = '2026-08-03T14:59:59+03:00'
const EARLIER = '2026-08-02T10:00:00+03:00'

describe('diagnosis-fee', () => {
  
  
  it('applies only from 3 Aug 2026 3pm EAT based on intakeDate', () => {
    expect(DIAGNOSIS_FEE_POLICY_EFFECTIVE_AT).toBe('2026-08-03T15:00:00+03:00')
    expect(isDiagnosisFeePolicyInEffect(AFTER)).toBe(true)
    expect(isDiagnosisFeePolicyInEffect(JUST_BEFORE)).toBe(false)
    expect(isDiagnosisFeePolicyInEffect(EARLIER)).toBe(false)
    expect(isDiagnosisFeePolicyInEffect(undefined)).toBe(false)
    expect(isDiagnosisFeePolicyInEffect('')).toBe(false)
    // Date-only Aug 3 (noon bookings with no time stored) stay pre-policy
    expect(isDiagnosisFeePolicyInEffect('2026-08-03')).toBe(false)
    expect(isDiagnosisFeePolicyInEffect('2026-08-03T12:00:00+03:00')).toBe(false)
    expect(isDiagnosisFeePolicyInEffect('2026-08-04')).toBe(true)
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

  it('builds a client-view diagnosis charge notice only when the fee applies', () => {
    const due = diagnosisFeeCustomerNotice({ repairPath: 'diagnosis_first', intakeDate: AFTER })
    expect(due?.status).toBe('due')
    expect(due?.amount).toBe(1000)
    expect(due?.body).toContain('KES 1,000.00')
    expect(due?.body).toContain('Diagnosis First')
    expect(due?.body).toContain('final invoice')

    expect(diagnosisFeeCustomerNotice({ repairPath: 'direct_repair', intakeDate: AFTER })).toBeNull()
    expect(diagnosisFeeCustomerNotice({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      underWarranty: true,
      warrantyCoverage: 'full',
    })).toBeNull()
    expect(diagnosisFeeCustomerNotice({
      repairPath: 'diagnosis_first',
      intakeDate: EARLIER,
    })).toBeNull()

    const paid = diagnosisFeeCustomerNotice({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'paid',
    })
    expect(paid?.status).toBe('paid')
    expect(paid?.body).toContain('has been paid')

    const invoiced = diagnosisFeeCustomerNotice({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'invoiced',
    })
    expect(invoiced?.status).toBe('invoiced')
    expect(invoiced?.body).toContain('included on your invoice')
  })

  it('copies diagnosis-fee fields for the live portal mapper', () => {
    expect(portalDiagnosisFeeFields({
      repairPath: 'diagnosis_first',
      intakeDate: AFTER,
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'applicable',
      billingExempt: false,
      underWarranty: false,
      warrantyCoverage: 'void',
    })).toMatchObject({
      repairPath: 'diagnosis_first',
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'applicable',
      intakeDate: AFTER,
      warrantyCoverage: 'void',
    })
    expect(portalDiagnosisFeeFields({}).repairPath).toBe('diagnosis_first')
  })
})

describe('diagnosisFeeLineBadge', () => {
  it('never reads Declined — it shows where the fee stands', () => {
    expect(diagnosisFeeLineBadge({ diagnosisFeeStatus: 'applicable' })).toEqual({ label: 'Fee due', tone: 'due' })
    expect(diagnosisFeeLineBadge({ diagnosisFeeStatus: 'paid' })).toEqual({ label: 'Paid', tone: 'settled' })
    expect(diagnosisFeeLineBadge({ diagnosisFeeStatus: 'invoiced' })).toEqual({ label: 'Invoiced', tone: 'settled' })
    expect(diagnosisFeeLineBadge({ diagnosisFeeStatus: 'applicable', diagnosisFeePaidAt: '2026-10-01' }).label).toBe('Paid')
    expect(diagnosisFeeLineBadge({ diagnosisFeeStatus: 'waived' }).label).toBe('Waived')
    expect(diagnosisFeeLineBadge({ diagnosisFeeStatus: 'not_applicable' }).label).toBe('No fee')
  })
})

describe('diagnosisFeeExitPatch — a job that ends without a repair', () => {
  const settings = { diagnosisFeeKes: 1000 }
  const diagnosed = {
    repairPath: 'diagnosis_first' as const,
    intakeDate: '2026-11-13T10:00:00+03:00',
    diagnosis: { findings: 'dead board' },
  }

  it('stamps the fee so the job can be billed after a decline or a return', () => {
    expect(diagnosisFeeExitPatch(diagnosed, settings)).toMatchObject({
      diagnosisFee: 1000,
      diagnosisFeeStatus: 'applicable',
    })
  })

  it('keeps a fee the customer already settled as paid', () => {
    expect(diagnosisFeeExitPatch({ ...diagnosed, diagnosisFeeStatus: 'paid' }, settings).diagnosisFeeStatus).toBe('paid')
    expect(diagnosisFeeExitPatch({ ...diagnosed, diagnosisFeePaidAt: '2026-11-14T09:00:00+03:00' }, settings).diagnosisFeeStatus).toBe('paid')
  })

  it('stamps nothing when no diagnosis was done', () => {
    expect(diagnosisFeeExitPatch({ ...diagnosed, diagnosis: undefined }, settings)).toEqual({})
  })

  it('stamps nothing on a direct repair, a waived fee or a no-charge job', () => {
    expect(diagnosisFeeExitPatch({ ...diagnosed, repairPath: 'direct_repair' }, settings)).toEqual({})
    expect(diagnosisFeeExitPatch({ ...diagnosed, diagnosisFeeStatus: 'waived' }, settings)).toEqual({})
    expect(diagnosisFeeExitPatch({ ...diagnosed, billingExempt: true }, settings)).toEqual({})
  })

  it('keeps the billing route already chosen on the job', () => {
    expect(diagnosisFeeExitPatch({ ...diagnosed, diagnosisFeeBilling: 'upfront', customerBillingType: 'corporate' }, settings))
      .toMatchObject({ diagnosisFeeBilling: 'upfront', customerBillingType: 'corporate' })
  })
})

describe('diagnosisFeeListCell — the Amount column on a job with no total', () => {
  const settings = { diagnosisFeeKes: 1000 }
  const booked = { repairPath: 'diagnosis_first' as const, intakeDate: '2026-11-13T10:00:00+03:00' }

  it('shows the fee in the due tone from the moment the job is booked', () => {
    expect(diagnosisFeeListCell(booked, settings)).toEqual({ amount: 1000, label: 'Fee due', tone: 'due' })
  })

  it('prefers the amount stamped on the job over the current policy', () => {
    expect(diagnosisFeeListCell({ ...booked, diagnosisFee: 1500 }, settings)?.amount).toBe(1500)
  })

  it('turns settled once the fee is paid or invoiced', () => {
    expect(diagnosisFeeListCell({ ...booked, diagnosisFeeStatus: 'paid' }, settings)).toMatchObject({ label: 'Paid', tone: 'settled' })
    expect(diagnosisFeeListCell({ ...booked, diagnosisFeeStatus: 'invoiced' }, settings)).toMatchObject({ label: 'Invoiced', tone: 'settled' })
  })

  it('shows nothing for a direct repair, a waived fee or a no-charge job', () => {
    expect(diagnosisFeeListCell({ ...booked, repairPath: 'direct_repair' }, settings)).toBeNull()
    expect(diagnosisFeeListCell({ ...booked, diagnosisFeeStatus: 'waived' }, settings)).toBeNull()
    expect(diagnosisFeeListCell({ ...booked, billingExempt: true }, settings)).toBeNull()
    expect(diagnosisFeeListCell(booked, { diagnosisFeeKes: 0 })).toBeNull()
  })

  it('shows nothing on a job booked before the fee policy began', () => {
    expect(diagnosisFeeListCell({ ...booked, intakeDate: '2026-01-04T10:00:00+03:00' }, settings)).toBeNull()
  })
})
