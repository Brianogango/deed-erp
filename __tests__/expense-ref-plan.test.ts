import { describe, expect, it } from 'vitest'
import { planExpenseRefRepair, type PlanClaim } from '@/lib/accounting/expense-ref-plan'

const claim = (id: string, ref: string, status: string, amount: number, submittedDate: string): PlanClaim =>
  ({ id, ref, status, amount, submittedDate, expenseDate: submittedDate.slice(0, 10) })

describe('planExpenseRefRepair', () => {
  it('keeps the number on the claim that owns its journal and renumbers the rest', () => {
    const plans = planExpenseRefRepair(
      [
        claim('a', 'EXP/0006', 'reimbursed', 50, '2026-06-01'),
        claim('b', 'EXP/0006', 'reimbursed', 3350, '2026-06-02'),
        claim('c', 'EXP/0006', 'submitted', 117, '2026-06-03'),
      ],
      [
        { ref: 'JRN/EXP/EXP/0006', blobId: 'b:reimbursement', totalDebit: 3350 },
        { ref: 'JRN/RIM/EXP/0006', blobId: 'b', totalDebit: 3350 },
      ],
    )
    const by = Object.fromEntries(plans.map(p => [p.id, p]))
    expect(by.b.newRef).toBe(false)
    expect(by.b.missing).toEqual([])
    expect(by.a.newRef).toBe(true)
    expect(by.a.missing).toEqual(['approval', 'reimbursement'])
    expect(by.c.newRef).toBe(true)
    expect(by.c.missing).toEqual([])
  })

  it('gives an older journal without a claim id to the claim with the same amount', () => {
    const plans = planExpenseRefRepair(
      [
        claim('a', 'EXP/0007', 'reimbursed', 485, '2026-06-01'),
        claim('b', 'EXP/0007', 'approved', 350, '2026-06-02'),
      ],
      [{ ref: 'JRN/EXP/EXP/0007', blobId: 'old-journal-uid', totalDebit: 350 }],
    )
    const by = Object.fromEntries(plans.map(p => [p.id, p]))
    expect(by.b.newRef).toBe(false)
    expect(by.b.owned.approval).toBe('JRN/EXP/EXP/0007')
    expect(by.a.newRef).toBe(true)
    expect(by.a.missing).toEqual(['approval', 'reimbursement'])
    expect(by.a.uncertain).toBeUndefined()
  })

  it('a renumbered claim keeps a journal it already owns under the old number', () => {
    const plans = planExpenseRefRepair(
      [
        claim('a', 'EXP/0008', 'approved', 115, '2026-06-01'),
        claim('b', 'EXP/0008', 'reimbursed', 580, '2026-06-02'),
      ],
      [
        { ref: 'JRN/EXP/EXP/0008', blobId: 'a:reimbursement', totalDebit: 115 },
        { ref: 'JRN/RIM/EXP/0008', blobId: 'b', totalDebit: 580 },
      ],
    )
    const by = Object.fromEntries(plans.map(p => [p.id, p]))
    expect(by.a.newRef).toBe(false)
    expect(by.b.newRef).toBe(true)
    expect(by.b.owned.reimbursement).toBe('JRN/RIM/EXP/0008')
    expect(by.b.missing).toEqual(['approval'])
  })

  it('ignores reversed journals and leaves unique numbers alone', () => {
    const plans = planExpenseRefRepair(
      [claim('a', 'EXP/0020', 'approved', 100, '2026-10-01')],
      [{ ref: 'JRN/EXP/EXP/0020', blobId: 'a:reimbursement', totalDebit: 100, isReversed: true }],
    )
    expect(plans[0].newRef).toBe(false)
    expect(plans[0].missing).toEqual(['approval'])
  })
})
