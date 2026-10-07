import { describe, expect, it } from 'vitest'
import { normalizeDocDate, planMissingDocs, planUnbookedPayments } from '@/lib/accounting/screen-ledger-sync'

describe('screen vs ledger', () => {
  it('reads an Excel serial date (46326 = 31 Oct 2026)', () => {
    expect(normalizeDocDate(46326)).toEqual({ iso: '2026-10-31', fromSerial: true })
    expect(normalizeDocDate('46326')).toEqual({ iso: '2026-10-31', fromSerial: true })
    expect(normalizeDocDate('2026-10-31T00:00:00Z').iso).toBe('2026-10-31')
    expect(normalizeDocDate('soon').iso).toBe('')
  })

  it('plans the Tokyo bill with a corrected date and a due date 30 days on', () => {
    const [plan] = planMissingDocs([
      { id: 'b1', ref: 'TOKYO-STMT-2026-10-31', type: 'vendor_bill', status: 'posted', total: 5032644, date: 46326, partnerId: 'p1', partnerName: 'Tokyo IT Solutions Ltd.' },
      { id: 'b2', ref: 'X', type: 'vendor_bill', status: 'draft', total: 10, date: '2026-10-01', partnerId: 'p1' },
      { id: 'b3', ref: 'IN', type: 'vendor_bill', status: 'posted', total: 10, date: '2026-10-01', partnerId: 'p1' },
    ], new Set(['b3']))
    expect(plan).toMatchObject({ ref: 'TOKYO-STMT-2026-10-31', date: '2026-10-31', dueDate: '2026-11-30', fixedDates: true, total: 5032644 })
    expect(plan.problem).toBeUndefined()
  })

  it('books the payments listed on screen that the ledger lacks, and leaves unlisted ones for a person', () => {
    const plans = planUnbookedPayments([
      { id: 'i1', ref: 'INV/2026/0226', status: 'posted', total: 2500, amountPaid: 2500, payments: [{ id: 'p1', amount: 2500, date: '2026-10-01', method: 'mpesa', reference: 'SJK1' }] },
      { id: 'i2', ref: 'INV/2026/0207', status: 'posted', total: 2500, amountPaid: 2500, payments: [] },
      { id: 'i3', ref: 'POS/0174', status: 'posted', total: 92827.84, amountPaid: 92828, payments: [] },
    ], new Map([
      ['i1', { amountPaid: 0, paymentIds: new Set<string>() }],
      ['i2', { amountPaid: 0, paymentIds: new Set<string>() }],
      ['i3', { amountPaid: 92827.84, paymentIds: new Set<string>() }],
    ]))
    expect(plans).toHaveLength(2)
    expect(plans.find(p => p.ref === 'INV/2026/0226')).toMatchObject({ manual: false, book: [{ id: 'p1', amount: 2500, method: 'mpesa', reference: 'SJK1' }] })
    expect(plans.find(p => p.ref === 'INV/2026/0207')).toMatchObject({ manual: true, book: [] })
  })
})

describe('the ledger start date', () => {
  it('leaves documents and payments from before 13 Sep to the opening balances', () => {
    expect(planMissingDocs([{ id: 'o1', ref: 'INV/2026/0001', type: 'customer_invoice', status: 'posted', total: 5000, date: '2026-01-01', partnerId: 'c1' }], new Set())).toEqual([])
    const plans = planUnbookedPayments(
      [{ id: 'i1', ref: 'INV/2026/0100', status: 'posted', total: 2500, amountPaid: 2500, date: '2026-08-01', payments: [{ id: 'p1', amount: 2500, date: '2026-08-02', method: 'cash' }] }],
      new Map([['i1', { amountPaid: 0, paymentIds: new Set<string>() }]]),
    )
    expect(plans).toEqual([])
  })
})
