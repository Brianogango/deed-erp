import { describe, expect, it } from 'vitest'
import { actorSatisfiesApprovalRoles } from '@/lib/sales-approval-rules'
import { canApprove, processApproval } from '@/lib/sales-approvals'
import { canOverrideCustomerCredit } from '@/lib/customer-credit-gate'
import type { ApprovalRequest } from '@/lib/sales-flow-types'

const twoLevel = (): ApprovalRequest => ({
  id: 'a1', ref: 'APR/1', type: 'credit_override',
  documentType: 'sales_order', documentId: 'so1', documentRef: 'SO/1',
  requestedBy: 'u1', requestedByName: 'Rep', requestedDate: '2026-11-13',
  details: { reason: 'Customer exceeds available credit' },
  approvers: [
    { level: 1, role: 'finance_officer', approverIds: ['fin'] },
    { level: 2, role: 'director', approverIds: ['dir'] },
  ],
  currentLevel: 1,
  status: 'pending',
} as ApprovalRequest)

describe('the Director can override', () => {
  it('any approval rule, including Finance-then-Director credit overrides', () => {
    expect(actorSatisfiesApprovalRoles('credit_override', ['finance_officer', 'director'], 'director')).toBe(true)
    expect(actorSatisfiesApprovalRoles('credit_override', ['finance_officer', 'director'], 'admin')).toBe(true)
    expect(actorSatisfiesApprovalRoles('credit_override', ['finance_officer', 'director'], 'finance_officer')).toBe(false)
  })

  it('a Director approval is final, whatever level the request is at', () => {
    const req = twoLevel()
    expect(canApprove(req, 'someone-else', 'director')).toBe(true)
    const done = processApproval(req, 'dir', 'Director', 'approved', 'override', 'director')
    expect(done.status).toBe('approved')
    expect(done.approvers.every(l => l.decision === 'approved' && l.decidedBy === 'dir')).toBe(true)
  })

  it('others still go level by level', () => {
    const next = processApproval(twoLevel(), 'fin', 'Finance', 'approved', undefined, 'finance_officer')
    expect(next.status).toBe('pending')
    expect(next.currentLevel).toBe(2)
    expect(() => processApproval(twoLevel(), 'rep', 'Rep', 'approved', undefined, 'sales_rep')).toThrow()
  })

  it('overdue invoices and credit limits: Director and Finance only', () => {
    expect(canOverrideCustomerCredit('director')).toBe(true)
    expect(canOverrideCustomerCredit('super_admin')).toBe(true)
    expect(canOverrideCustomerCredit('finance_officer')).toBe(true)
    expect(canOverrideCustomerCredit('finance')).toBe(true)
    expect(canOverrideCustomerCredit('sales_rep')).toBe(false)
    expect(canOverrideCustomerCredit(undefined)).toBe(false)
  })
})
