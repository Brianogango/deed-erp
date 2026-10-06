import { describe, expect, it } from 'vitest'
import { buildDirectorBrief, directorBriefBody, directorBriefTitle, type DirectorBriefInput } from '@/lib/notifications/director-brief'

const empty: DirectorBriefInput = {
  billsOverdue: [], billsDueSoon: [], invoicesOverdue: [], leavePending: [], advancesPending: [],
  payrollPending: [], posAwaitingApproval: [], checkoutsPending: [], checkoutsOverdue: [], invoicedNotDelivered: [],
}

describe('director morning brief', () => {
  it('has nothing to say on a quiet day', () => {
    expect(buildDirectorBrief(empty)).toEqual([])
  })

  it('puts bills to pay and approvals first, with totals', () => {
    const sections = buildDirectorBrief({
      ...empty,
      billsOverdue: [
        { ref: 'BILL/1', supplier: 'Tech Supplies', balance: 20000, dueDate: '2026-10-01' },
        { ref: 'BILL/2', supplier: null, balance: 50000, dueDate: '2026-09-28' },
      ],
      billsDueSoon: [{ ref: 'BILL/3', supplier: 'KPLC', balance: 5000, dueDate: '2026-10-09' }],
      leavePending: [{ ref: 'LV-1', employee: 'Jane W', type: 'annual_leave', from: '2026-10-12', to: '2026-10-14', days: 3 }],
      advancesPending: [{ ref: 'SA-1', employee: 'Tom K', amount: 10000 }],
      invoicesOverdue: [{ ref: 'INV/9', customer: 'D.Light', balance: 300000, dueDate: '2026-09-01' }],
    })
    expect(sections.map(s => s.key)).toEqual(['bills_overdue', 'bills_due', 'leave', 'advances', 'invoices_overdue'])
    expect(sections[0].heading).toBe('Bills overdue — 2 bills, KES 70,000')
    // Largest overdue bill first.
    expect(sections[0].lines[0]).toBe('BILL/2 — KES 50,000 (due 2026-09-28)')
    expect(sections[2].lines[0]).toBe('Jane W — annual leave, 2026-10-12 to 2026-10-14 (3 days)')
    expect(directorBriefTitle(sections)).toBe('Morning brief — KES 75,000 of bills to pay, 2 approvals waiting')
    expect(directorBriefBody(sections)).toContain('• INV/9 D.Light — KES 300,000 (due 2026-09-01)')
  })

  it('shows five lines per section and counts the rest', () => {
    const sections = buildDirectorBrief({
      ...empty,
      checkoutsPending: Array.from({ length: 8 }, (_, i) => ({ ref: `CHK-${i}`, product: 'SSD 512GB', qty: 1, receiver: 'Workshop' })),
    })
    expect(sections[0].lines).toHaveLength(6)
    expect(sections[0].lines[5]).toBe('…and 3 more')
    expect(directorBriefTitle(sections)).toBe('Morning brief — 8 approvals waiting')
  })

  it('names checkouts not returned and machines not delivered', () => {
    const sections = buildDirectorBrief({
      ...empty,
      checkoutsOverdue: [{ ref: 'CHK-2', product: 'HP 845 G7', qty: 1, receiver: 'Derrick', expected: '2026-10-01' }],
      invoicedNotDelivered: [{ ref: 'SO/2026/0004', customer: 'D.Light', units: 43 }],
    })
    expect(directorBriefBody(sections)).toContain('CHK-2 — 1 × HP 845 G7 with Derrick (due back 2026-10-01)')
    expect(directorBriefBody(sections)).toContain('SO/2026/0004 D.Light — 43 machines still in stock')
    expect(directorBriefTitle(sections)).toBe('Morning brief — 2 items to review')
  })
})
