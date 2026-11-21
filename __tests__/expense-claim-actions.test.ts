import { describe, expect, it } from 'vitest'
import {
  editClaim,
  guardClaimRegression,
  payClaims,
  resubmitClaim,
  reviewClaims,
  withdrawClaim,
  type Claim,
} from '@/lib/expenses/claim-actions'

const now = '2026-11-21T09:00:00.000Z'
const finance = { id: 'f1', name: 'Faith', role: 'finance_officer', managesAll: true }
const director = { id: 'd1', name: 'Dan', role: 'director', approvesOwn: true, managesAll: true }
const jane = { id: 'u1', name: 'Jane', role: 'sales_rep' }

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: 'c1', ref: 'EXP/0001', status: 'submitted', amount: 1200, category: 'transport', description: 'Fuel',
  expenseDate: '2026-11-18', paymentMethod: 'reimbursement', submittedByUserId: 'u1', submittedByName: 'Jane',
  approvalChain: [{ role: 'finance_officer', status: 'pending' }],
  ...over,
})

describe('approving and rejecting', () => {
  it('approves many at once and reports which became fully approved', () => {
    const list = [claim(), claim({ id: 'c2', ref: 'EXP/0002', amount: 800 }), claim({ id: 'c3', ref: 'EXP/0003', status: 'paid' })]
    const out = reviewClaims(list, ['c1', 'c2', 'c3'], { approved: true, actor: finance, now })
    expect(out.fullyApproved.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(out.failed.map(f => f.id)).toEqual(['c3'])
    expect(out.claims.find(c => c.id === 'c1')!.history!.at(-1)).toMatchObject({ by: 'Faith', action: 'approved' })
  })

  it('a two-step claim waits for the next approver', () => {
    const c = claim({ amount: 80000, approvalChain: [{ role: 'finance_officer', status: 'pending' }, { role: 'director', status: 'pending' }] })
    const step1 = reviewClaims([c], ['c1'], { approved: true, actor: finance, now })
    expect(step1.changed[0].status).toBe('submitted')
    expect(step1.fullyApproved).toHaveLength(0)
    const step2 = reviewClaims(step1.claims, ['c1'], { approved: true, actor: director, now })
    expect(step2.changed[0].status).toBe('approved')
  })

  it('nobody but the Director approves their own claim', () => {
    const own = claim({ submittedByUserId: 'f1' })
    expect(reviewClaims([own], ['c1'], { approved: true, actor: finance, now }).failed).toHaveLength(1)
    expect(reviewClaims([claim({ submittedByUserId: 'd1' })], ['c1'], { approved: true, actor: director, now }).changed).toHaveLength(1)
  })
})

describe('paying', () => {
  const approved = (over: Partial<Claim> = {}) => claim({ status: 'approved', ...over })

  it('several staff claims in one payment, all carrying the payment number', () => {
    const out = payClaims([approved(), approved({ id: 'c2', ref: 'EXP/0002', amount: 800 })], ['c1', 'c2'], {
      method: 'mpesa', bankAccountId: 'mpesa', reference: 'QGH1', date: '2026-11-21', batchRef: 'EXPB/0001', actor: finance, now,
    })
    expect(out.kind).toBe('reimbursement')
    expect(out.total).toBe(2000)
    expect(out.changed.every(c => c.status === 'reimbursed' && c.paymentBatchRef === 'EXPB/0001')).toBe(true)
  })

  it('refuses to mix staff reimbursements and company-paid expenses, or pay unapproved claims', () => {
    expect(payClaims([approved(), approved({ id: 'c2', paymentMethod: 'company_card' })], ['c1', 'c2'], { method: 'bank', bankAccountId: 'b', date: '2026-11-21', actor: finance, now }).failed.length).toBeGreaterThan(0)
    expect(payClaims([claim()], ['c1'], { method: 'bank', bankAccountId: 'b', date: '2026-11-21', actor: finance, now }).failed[0].reason).toMatch(/not approved/)
  })
})

describe('the claimant', () => {
  it('can change a claim nobody has acted on; a new amount rebuilds the approvers', () => {
    const out = editClaim([claim()], 'c1', { amount: 90000, description: 'Fuel, 3 trips' }, { actor: jane, now })
    expect(out.error).toBeUndefined()
    expect(out.changed!.amount).toBe(90000)
    expect(out.changed!.approvalChain!.map(s => s.role)).toEqual(['finance_officer', 'director'])
    expect(out.changed!.history!.at(-1)!.note).toMatch(/amount: 1200 → 90000/)
  })

  it('cannot change or withdraw once a step is approved, or someone else\'s claim', () => {
    const stepped = claim({ approvalChain: [{ role: 'finance_officer', status: 'approved' }, { role: 'director', status: 'pending' }] })
    expect(editClaim([stepped], 'c1', { amount: 5 }, { actor: jane, now }).error).toMatch(/reviewed/)
    expect(withdrawClaim([stepped], 'c1', { actor: jane, now }).error).toMatch(/reviewed/)
    expect(editClaim([claim()], 'c1', { amount: 5 }, { actor: { id: 'x', name: 'X', role: 'sales_rep' }, now }).error).toMatch(/Only the person/)
  })

  it('withdraws, then sends it again with the same number and a fresh approval', () => {
    const w = withdrawClaim([claim()], 'c1', { actor: jane, now, reason: 'Wrong amount' })
    expect(w.changed!.status).toBe('withdrawn')
    const r = resubmitClaim(w.claims, 'c1', { amount: 1100 }, { actor: jane, now })
    expect(r.changed).toMatchObject({ ref: 'EXP/0001', status: 'submitted', amount: 1100 })
    expect(r.changed!.approvalChain!.every(s => s.status === 'pending')).toBe(true)
    expect(r.changed!.history!.map(h => h.action)).toEqual(['withdrawn', 'sent again'])
  })

  it('a rejected claim corrected keeps its rejection in its history', () => {
    const rejected = reviewClaims([claim()], ['c1'], { approved: false, notes: 'No receipt', actor: finance, now })
    const again = resubmitClaim(rejected.claims, 'c1', { receiptFileName: 'r.jpg', receiptFileType: 'image/jpeg', receiptFileSize: 10 }, { actor: jane, now })
    expect(again.changed!.receiptFileName).toBe('r.jpg')
    expect(again.changed!.history!.map(h => h.action)).toEqual(['rejected', 'sent again'])
  })

  it('a stored receipt is never replaced by an edit', () => {
    const out = editClaim([claim({ receiptFileName: 'old.jpg' })], 'c1', { receiptFileName: 'new.jpg' }, { actor: jane, now })
    expect(out.changed!.receiptFileName).toBe('old.jpg')
  })
})

describe('saves from an older screen', () => {
  it('cannot undo a payment or change an approved claim\'s amount', () => {
    const server = [claim({ status: 'reimbursed', paymentBatchRef: 'EXPB/0001' }), claim({ id: 'c2', status: 'approved', amount: 500 })]
    const incoming = [claim({ status: 'approved' }), claim({ id: 'c2', status: 'approved', amount: 99999 })]
    const out = guardClaimRegression(server, incoming)
    expect(out[0]).toMatchObject({ status: 'reimbursed', paymentBatchRef: 'EXPB/0001' })
    expect(out[1].amount).toBe(500)
  })

  it('cannot reopen a rejected claim without the server', () => {
    const out = guardClaimRegression([claim({ status: 'rejected' })], [claim({ status: 'submitted' })])
    expect(out[0].status).toBe('rejected')
  })

  it('lets new claims, forward moves and edits of waiting claims through', () => {
    const server = [claim({ id: 'c2', status: 'submitted' })]
    const incoming = [claim({ id: 'new' }), claim({ id: 'c2', status: 'approved' })]
    expect(guardClaimRegression(server, incoming)).toEqual(incoming)
  })
})
