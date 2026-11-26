import { describe, expect, it } from 'vitest'
import { cancelClaim, deleteClaim, guardClaimRegression, type Claim } from '@/lib/expenses/claim-actions'

// Claims raised although the company had already given the money must be
// stopped even after approval, and removable from the list.
const now = '2026-11-26T10:00:00.000Z'
const finance = { id: 'f1', name: 'Faith', role: 'finance_officer', managesAll: true }
const jane = { id: 'u1', name: 'Jane', role: 'sales_rep' }
const claim = (over: Partial<Claim> = {}): Claim => ({
  id: 'c1', ref: 'EXP/0001', status: 'approved', amount: 1200, category: 'transport', description: 'Fuel',
  expenseDate: '2026-11-18', paymentMethod: 'reimbursement', submittedByUserId: 'u1', submittedByName: 'Jane', ...over,
})

describe('cancelling a claim', () => {
  it('cancels an approved claim and asks for its approval to be reversed', () => {
    const out = cancelClaim([claim()], 'c1', { actor: finance, now, reason: 'Duplicate — cash advance already given' })
    expect(out.error).toBeUndefined()
    expect(out.reverseApproval).toBe(true)
    expect(out.changed).toMatchObject({ status: 'cancelled', cancelledByName: 'Faith', cancelReason: 'Duplicate — cash advance already given' })
    expect(out.changed!.history!.at(-1)).toMatchObject({ action: 'cancelled after approval' })
  })

  it('cancels a claim still in review without touching the books', () => {
    const out = cancelClaim([claim({ status: 'submitted' })], 'c1', { actor: finance, now, reason: 'Duplicate' })
    expect(out.changed?.status).toBe('cancelled')
    expect(out.reverseApproval).toBe(false)
  })

  it('needs a reason and Finance', () => {
    expect(cancelClaim([claim()], 'c1', { actor: finance, now, reason: '  ' }).error).toMatch(/why/)
    expect(cancelClaim([claim()], 'c1', { actor: jane, now, reason: 'x' }).error).toMatch(/Finance/)
  })

  it('refuses a paid claim: the money has left', () => {
    for (const status of ['paid', 'reimbursed'] as const) {
      expect(cancelClaim([claim({ status })], 'c1', { actor: finance, now, reason: 'x' }).error).toMatch(/refund/)
    }
  })
})

describe('deleting a claim', () => {
  it('deletes a cancelled claim by hiding it, kept on record', () => {
    const out = deleteClaim([claim({ status: 'cancelled' })], 'c1', { actor: finance, now })
    expect(out.changed).toMatchObject({ deletedAt: now, deletedByName: 'Faith', status: 'cancelled' })
  })

  it('lets the claimant delete their own rejected or withdrawn claim, not a cancelled one', () => {
    expect(deleteClaim([claim({ status: 'withdrawn' })], 'c1', { actor: jane, now }).error).toBeUndefined()
    expect(deleteClaim([claim({ status: 'rejected' })], 'c1', { actor: jane, now }).error).toBeUndefined()
    expect(deleteClaim([claim({ status: 'cancelled' })], 'c1', { actor: jane, now }).error).toMatch(/Finance/)
  })

  it('refuses open and paid claims', () => {
    expect(deleteClaim([claim()], 'c1', { actor: finance, now }).error).toMatch(/cancel it first/)
    expect(deleteClaim([claim({ status: 'paid' })], 'c1', { actor: finance, now }).error).toMatch(/stays on record/)
  })
})

describe('an older screen saving its copy', () => {
  it('cannot undo a cancellation', () => {
    const server = [claim({ status: 'cancelled', cancelReason: 'Duplicate' })]
    const [row] = guardClaimRegression(server, [claim({ status: 'approved' })])
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'Duplicate' })
  })

  it('cannot bring a deleted claim back', () => {
    const server = [claim({ status: 'cancelled', deletedAt: now })]
    const [row] = guardClaimRegression(server, [claim({ status: 'approved', deletedAt: undefined })])
    expect(row.deletedAt).toBe(now)
  })
})
