import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_RULES, FINANCE_APPROVAL_LIMIT, approvalCheck, approvalLevel, canDecide, documentChecklist, nextRef, nextStatus, reviewDueFrom,
} from '@/lib/credit/credit-facility-rules'

const today = new Date('2026-10-11T10:00:00Z')
const allVerified = DOCUMENT_RULES.filter(r => r.required).map(r => ({
  kind: r.kind, status: 'verified', expiresOn: r.expires ? '2027-06-30' : null,
}))

describe('credit facility rules', () => {
  it('finance approves up to KES 100,000; a director above it', () => {
    expect(approvalLevel(FINANCE_APPROVAL_LIMIT)).toBe('finance_officer')
    expect(approvalLevel(FINANCE_APPROVAL_LIMIT + 1)).toBe('director')
    expect(canDecide('finance_officer', 'finance_officer')).toBe(true)
    expect(canDecide('finance_officer', 'director')).toBe(false)
    expect(canDecide('director', 'director')).toBe(true)
    expect(canDecide('sales_rep', 'finance_officer')).toBe(false)
  })

  it('fewer than three paid transactions needs a director (payment policy)', () => {
    const base = { approvedLimit: 50_000, approvedTermsDays: 30, riskClass: 'low', documents: allVerified, today }
    expect(approvalCheck({ ...base, paidTransactions: 3 })).toEqual({ blockers: [], level: 'finance_officer', policyException: false })
    expect(approvalCheck({ ...base, paidTransactions: 2 })).toMatchObject({ blockers: [], level: 'director', policyException: true })
  })

  it('blocks approval until every required document is verified and current', () => {
    const missing = approvalCheck({ approvedLimit: 50_000, approvedTermsDays: 30, riskClass: 'low', documents: [], paidTransactions: 5, today })
    expect(missing.blockers).toHaveLength(DOCUMENT_RULES.filter(r => r.required).length)

    const expired = allVerified.map(d => d.kind === 'tax_compliance_certificate' ? { ...d, expiresOn: '2026-01-01' } : d)
    expect(approvalCheck({ approvedLimit: 50_000, approvedTermsDays: 30, riskClass: 'low', documents: expired, paidTransactions: 5, today }).blockers)
      .toEqual(['VAT / tax compliance certificate: expired — a current copy is needed'])

    const noExpiry = allVerified.map(d => d.kind === 'business_permit' ? { ...d, expiresOn: null } : d)
    expect(approvalCheck({ approvedLimit: 50_000, approvedTermsDays: 30, riskClass: 'low', documents: noExpiry, paidTransactions: 5, today }).blockers)
      .toEqual(['Valid current business permit: record its expiry date'])
  })

  it('needs a limit, terms and a risk class', () => {
    expect(approvalCheck({ approvedLimit: 0, approvedTermsDays: 0, riskClass: null, documents: allVerified, paidTransactions: 5, today }).blockers)
      .toEqual(['Set the credit limit to approve', 'Set the payment terms (days) to approve', 'Classify the risk (low, medium or high)'])
  })

  it('checklist states', () => {
    const list = documentChecklist([
      { kind: 'application_form', status: 'received' },
      { kind: 'bank_statements', status: 'rejected' },
      { kind: 'audited_financials', status: 'verified' },
    ], today)
    const state = (k: string) => list.find(i => i.kind === k)?.state
    expect(state('application_form')).toBe('received')
    expect(state('bank_statements')).toBe('rejected')
    expect(state('audited_financials')).toBe('verified')
    expect(state('directors_ids')).toBe('missing')
  })

  it('status moves', () => {
    expect(nextStatus('approve', 'draft')).toBeNull()
    expect(nextStatus('submit', 'info_requested')).toBe('submitted')
    expect(nextStatus('recommend', 'under_review')).toBe('recommended')
    expect(nextStatus('approve', 'recommended')).toBe('approved')
    expect(nextStatus('suspend', 'approved')).toBe('suspended')
    expect(nextStatus('reinstate', 'suspended')).toBe('approved')
    expect(nextStatus('revoke', 'declined')).toBeNull()
  })

  it('refs and review dates', () => {
    expect(nextRef(2026, null)).toBe('CA/2026/0001')
    expect(nextRef(2026, 'CA/2026/0041')).toBe('CA/2026/0042')
    expect(reviewDueFrom(new Date('2026-10-11T10:00:00Z'))).toBe('2027-10-11')
  })
})
