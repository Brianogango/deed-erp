import { describe, expect, it, vi } from 'vitest'
import {
  defaultExpectedReturnDate,
  findStockSerialForOutsource,
  outsourceHandoverSlipHtml,
  statusAfterUnfixedReturn,
  suggestedCustomerCharge,
  vendorScorecard,
} from '@/lib/repair/outsource-jobs'
import { isOutsourceOverdue, outsourceDaysLate } from '@/lib/repair/outsource-visibility'
import { createRepairActions } from '@/lib/store/actions/repairs'

const now = new Date('2026-11-21T10:00:00Z')

describe('promised return date', () => {
  it('adds the usual turnaround for the service', () => {
    expect(defaultExpectedReturnDate('2026-11-20', 'screen_replacement')).toBe('2026-11-23')
    expect(defaultExpectedReturnDate('2026-11-20', 'motherboard_repair')).toBe('2026-12-04')
    expect(defaultExpectedReturnDate('', 'screen_replacement')).toBe('')
  })

  it('is late only after the promised day', () => {
    const job = { status: 'sent', sentDate: '2026-11-01', expectedReturnDate: '2026-11-21' }
    expect(isOutsourceOverdue(job, now)).toBe(false)
    expect(outsourceDaysLate(job, now)).toBe(0)
    expect(isOutsourceOverdue({ ...job, expectedReturnDate: '2026-11-19' }, now)).toBe(true)
    expect(outsourceDaysLate({ ...job, expectedReturnDate: '2026-11-19' }, now)).toBe(2)
  })

  it('a long job with a far promise is not late after a week', () => {
    expect(isOutsourceOverdue({ status: 'sent', sentDate: '2026-11-10', expectedReturnDate: '2026-11-24' }, now)).toBe(false)
  })

  it('old jobs without a promise still go late after a week', () => {
    expect(isOutsourceOverdue({ status: 'sent', sentDate: '2026-11-10' }, now)).toBe(true)
    expect(isOutsourceOverdue({ status: 'sent', sentDate: '2026-11-18' }, now)).toBe(false)
  })

  it('a cancelled job is never late', () => {
    expect(isOutsourceOverdue({ status: 'cancelled', sentDate: '2026-06-01' }, now)).toBe(false)
  })
})

describe('machine back not fixed, "keep"', () => {
  it('goes back to the status it had before it went out', () => {
    expect(statusAfterUnfixedReturn('keep', 'awaiting_parts')).toBe('awaiting_parts')
    expect(statusAfterUnfixedReturn(undefined, 'diagnosed')).toBe('diagnosed')
    expect(statusAfterUnfixedReturn('keep', undefined)).toBe('in_repair')
    expect(statusAfterUnfixedReturn('in_repair', 'awaiting_parts')).toBe('in_repair')
    expect(statusAfterUnfixedReturn('unrepairable', 'awaiting_parts')).toBe('unrepairable')
  })
})

describe('customer charge', () => {
  it('adds the markup and rounds up to 50', () => {
    expect(suggestedCustomerCharge(3000)).toBe(3900)
    expect(suggestedCustomerCharge(2010)).toBe(2650)
    expect(suggestedCustomerCharge(0)).toBe(0)
  })
})

describe('vendor scorecard', () => {
  const jobs = [
    { vendorId: 'v1', status: 'returned_resolved', sentDate: '2026-11-01', returnedDate: '2026-11-04', expectedReturnDate: '2026-11-04', quotedCost: 2000, finalCost: 2000 },
    { vendorId: 'v1', status: 'returned_resolved', sentDate: '2026-11-01', returnedDate: '2026-11-11', expectedReturnDate: '2026-11-05', quotedCost: 2000, finalCost: 3000 },
    { vendorId: 'v1', status: 'returned_unresolved', sentDate: '2026-11-01', returnedDate: '2026-11-07', finalCost: 500 },
    { vendorId: 'v1', status: 'sent', sentDate: '2026-11-01', expectedReturnDate: '2026-11-10' },
    { vendorId: 'v1', status: 'cancelled', sentDate: '2026-11-01' },
    { vendorId: 'v2', status: 'returned_resolved', sentDate: '2026-11-01', returnedDate: '2026-11-02' },
  ]
  it('counts fixes, speed, promises kept and cost against quote', () => {
    expect(vendorScorecard('v1', jobs, now)).toEqual({
      jobs: 4, out: 1, overdueNow: 1, returned: 3, fixed: 2, fixRate: 67, avgDaysOut: 6,
      onTimeRate: 50, overQuote: 1, avgCostVsQuotePct: 25, spent: 5500,
    })
  })
})

describe('stock machine sent out', () => {
  const serials = [
    { id: 's1', serial: 'ABC123', barcode: 'ABC123', productId: 'p1', productName: 'HP 840', location: 'warehouse', status: 'available' },
    { id: 's2', serial: 'SOLD1', barcode: 'SOLD1', productId: 'p1', productName: 'HP 840', location: 'customer', status: 'sold' },
  ]
  it('finds our machine by serial, ignoring case', () => {
    expect(findStockSerialForOutsource(serials, ' abc123 ')?.id).toBe('s1')
  })
  it('ignores sold machines and empty input', () => {
    expect(findStockSerialForOutsource(serials, 'SOLD1')).toBeUndefined()
    expect(findStockSerialForOutsource(serials, '')).toBeUndefined()
  })
})

describe('handover slip', () => {
  it('escapes what people typed', () => {
    const html = outsourceHandoverSlipHtml({
      companyName: 'Deed', jobRef: 'OUT/0001', vendorName: 'Fix <b>It</b>', deviceDescription: 'HP', serviceLabel: 'Screen',
      issueDescription: '"broken"', sentDate: '2026-11-20', sentByName: 'Ann', fmtKes: n => `KSh ${n}`, fmtDate: d => d,
    })
    expect(html).toContain('Fix &lt;b&gt;It&lt;/b&gt;')
    expect(html).toContain('&quot;broken&quot;')
    expect(html).toContain('Device only')
  })
})

// ── Store actions against a small fake store ─────────────────────────────────

function fakeStore(over: Record<string, unknown> = {}) {
  const state = {
    jobs: [] as any[],
    repairs: [] as any[],
    serials: [] as any[],
    moves: [] as any[],
    bills: 0,
    toasts: [] as string[],
  }
  const apply = <T,>(list: T[], fn: T[] | ((p: T[]) => T[])) => (typeof fn === 'function' ? (fn as (p: T[]) => T[])(list) : fn)
  const store: any = {
    outsourceJobsRef: { current: state.jobs },
    repairsRef: { current: state.repairs },
    serialRef: { current: state.serials },
    users: [],
    outsourceVendors: [{ id: 'v1', name: 'Fastech', phone: '0700', specializations: [], createdAt: '', active: true }],
    contacts: [],
    companySettings: { vatRate: 16 },
    currentUser: () => ({ id: 'u2', name: 'Grace' }),
    currentUserId: 'u2',
    showToast: (m: string) => state.toasts.push(m),
    setOutsourceJobs: (fn: any) => { state.jobs = apply(state.jobs, fn); store.outsourceJobsRef.current = state.jobs },
    setRepairs: (fn: any) => { state.repairs = apply(state.repairs, fn); store.repairsRef.current = state.repairs },
    setSerials: (fn: any) => { state.serials = apply(state.serials, fn); store.serialRef.current = state.serials },
    addMove: (...args: unknown[]) => state.moves.push(args),
    createOutsourceBill: () => { state.bills += 1; return `bill-${state.bills}` },
    syncRepairToPortal: vi.fn(),
    addAuditLog: vi.fn(),
    notifyUsers: vi.fn(),
    outsourceRef: () => 'OUT/0001',
    markRepairLockedForOutsource: (r: any) => ({ ...r, status: 'in_repair' }),
    getActiveOutsourceJob: (id: string) => state.jobs.find(j => j.repairOrderId === id && j.status === 'sent'),
    fmtKes: (n: number) => `KSh ${n}`,
    ...over,
  }
  return { store, state, actions: createRepairActions(store) }
}

const sentJob = (over: Record<string, unknown> = {}) => ({
  id: 'j1', ref: 'OUT/0001', vendorId: 'v1', vendorName: 'Fastech', deviceDescription: 'HP 840', serviceType: 'screen_replacement',
  issueDescription: 'Cracked', sentDate: '2026-11-18', sentByUserId: 'u1', sentByName: 'Ann', status: 'sent', createdAt: '', ...over,
})

describe('returning a job', () => {
  it('bills once even when marked returned twice', () => {
    const { store, state, actions } = fakeStore()
    store.setOutsourceJobs([sentJob()])
    expect(actions.returnOutsourceJob('j1', { returnedDate: '2026-11-21', isResolved: false, finalCost: 1500 })).toBe(true)
    expect(actions.returnOutsourceJob('j1', { returnedDate: '2026-11-21', isResolved: false, finalCost: 1500 })).toBe(false)
    expect(state.bills).toBe(1)
    expect(state.jobs[0].returnedByName).toBe('Grace')
  })

  it('records who received it on the repair, and "keep" restores the earlier status', () => {
    const { store, state, actions } = fakeStore()
    store.setRepairs([{ id: 'r1', ref: 'REP/1', status: 'in_repair', statusHistory: [] }])
    store.setOutsourceJobs([sentJob({ repairOrderId: 'r1', previousRepairStatus: 'awaiting_parts' })])
    actions.returnOutsourceJob('j1', { returnedDate: '2026-11-21', isResolved: false, repairNextStep: 'keep' })
    expect(state.repairs[0].status).toBe('awaiting_parts')
    expect(state.repairs[0].statusHistory.at(-1).by).toBe('Grace')
  })
})

describe('cancelling a job', () => {
  it('needs a reason, frees the repair and raises no bill', () => {
    const { store, state, actions } = fakeStore()
    store.setRepairs([{ id: 'r1', ref: 'REP/1', status: 'in_repair', statusHistory: [] }])
    store.setOutsourceJobs([sentJob({ repairOrderId: 'r1', previousRepairStatus: 'diagnosed' })])
    expect(actions.cancelOutsourceJob('j1', '  ')).toBe(false)
    expect(actions.cancelOutsourceJob('j1', 'Wrong vendor')).toBe(true)
    expect(state.jobs[0].status).toBe('cancelled')
    expect(state.repairs[0].status).toBe('diagnosed')
    expect(state.bills).toBe(0)
    expect(actions.cancelOutsourceJob('j1', 'again')).toBe(false)
  })
})

describe('a stock machine', () => {
  it('moves to Vendor when sent and home again when it returns', () => {
    const { store, state, actions } = fakeStore()
    store.setSerials([{ id: 's1', serial: 'ABC123', barcode: 'ABC123', productId: 'p1', productName: 'HP 840', location: 'warehouse', status: 'available' }])
    const job = actions.addOutsourceJob({ vendorId: 'v1', vendorName: 'Fastech', deviceDescription: 'HP 840', serial: 'ABC123', serviceType: 'screen_replacement', issueDescription: 'Cracked', sentDate: '2026-11-20' } as any)
    expect(job?.stockSerialId).toBe('s1')
    expect(job?.expectedReturnDate).toBe('2026-11-23')
    expect(state.serials[0].location).toBe('vendor')
    actions.returnOutsourceJob(job!.id, { returnedDate: '2026-11-21', isResolved: true })
    expect(state.serials[0].location).toBe('warehouse')
    expect(state.moves).toHaveLength(2)
  })

  it('cannot go to an inactive vendor', () => {
    const { actions } = fakeStore({ outsourceVendors: [{ id: 'v1', name: 'Fastech', active: false, specializations: [] }] })
    expect(actions.addOutsourceJob({ vendorId: 'v1', vendorName: 'Fastech', deviceDescription: 'HP', serviceType: 'other', issueDescription: 'x', sentDate: '2026-11-20' } as any)).toBeNull()
  })
})

describe('charging the customer', () => {
  it('adds a line to the quote and keeps the status the return just set', () => {
    const { store, state, actions } = fakeStore()
    store.setRepairs([{
      id: 'r1', ref: 'REP/1', status: 'in_repair', statusHistory: [],
      quote: { id: 'q', lines: [], subtotal: 1000, tax: 160, total: 1160, validUntil: '', sentDate: '' },
    }])
    store.setOutsourceJobs([sentJob({ repairOrderId: 'r1' })])
    actions.returnOutsourceJob('j1', { returnedDate: '2026-11-21', isResolved: true, finalCost: 3000 })
    expect(actions.chargeOutsourceToRepair('j1', 3900)).toBe(true)
    const repair = state.repairs[0]
    expect(repair.status).toBe('qc')
    expect(repair.quote.lines).toHaveLength(1)
    expect(repair.quote.subtotal).toBe(4900)
    expect(repair.quote.total).toBe(1160 + 3900 + 624)
    expect(actions.chargeOutsourceToRepair('j1', 3900)).toBe(false)
  })
})

describe('vendors', () => {
  it('only removes a vendor with no jobs', () => {
    const removed: string[] = []
    const { store, actions } = fakeStore({ setOutsourceVendors: () => removed.push('v1') })
    store.setOutsourceJobs([sentJob()])
    expect(actions.deleteOutsourceVendor('v1')).toBe(false)
    store.setOutsourceJobs([])
    expect(actions.deleteOutsourceVendor('v1')).toBe(true)
    expect(removed).toEqual(['v1'])
  })
})
