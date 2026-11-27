import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/accounting/journal-service', () => ({
  persistStoreJournalEntry: vi.fn(),
  persistStoreJournalEntryInTx: vi.fn(),
  reverseJournalEntry: vi.fn(),
}))

import { buildPosSaleLines } from '@/lib/accounting/posting-service'
import {
  fillLastTender,
  posTenders,
  primaryTenderMethod,
  splitProblem,
  tenderTotalsByMethod,
  tendersLabel,
} from '@/lib/pos-tenders'
import { payLabel } from '@/lib/pos-transaction-history'

describe('POS split payment', () => {
  it('fills a blank last part with the rest', () => {
    const t = fillLastTender([
      { method: 'cash', amount: 5000 },
      { method: 'bank', amount: null, bankAccountId: 'ncba' },
    ], 25000)
    expect(t).toEqual([{ method: 'cash', amount: 5000 }, { method: 'bank', amount: 20000, bankAccountId: 'ncba' }])
    expect(primaryTenderMethod(t)).toBe('bank')
  })

  it('checks the parts before charging', () => {
    const ok = [{ method: 'cash' as const, amount: 5000 }, { method: 'bank' as const, amount: 20000, bankAccountId: 'ncba' }]
    expect(splitProblem(ok, 25000)).toBeNull()
    expect(splitProblem([ok[0]], 25000)).toMatch(/at least two/)
    expect(splitProblem([ok[0], { method: 'bank', amount: 20000 }], 25000)).toMatch(/bank account/)
    expect(splitProblem([ok[0], { ...ok[1], amount: 19000 }], 25000)).toMatch(/1,000 still to collect/)
    expect(splitProblem([ok[0], { ...ok[1], amount: 21000 }], 25000)).toMatch(/more than due/)
    expect(splitProblem([{ method: 'mpesa', amount: 1 }, { method: 'mpesa', amount: 24999 }], 25000)).toMatch(/one M-Pesa/)
  })

  it('counts each part in its own till total', () => {
    const orders = [
      { total: 25000, payment: 'bank', splitPayments: [{ method: 'cash' as const, amount: 5000 }, { method: 'bank' as const, amount: 20000, bankAccountId: 'ncba' }] },
      { total: 3000, payment: 'mpesa' },
      { total: 10000, payment: 'cash', customerCreditAmount: 4000 },
    ]
    expect(tenderTotalsByMethod(orders)).toEqual({ cash: 11000, mpesa: 3000, bank: 20000 })
    expect(posTenders(orders[2])).toEqual([{ method: 'cash', amount: 6000 }])
    expect(tendersLabel(orders[0])).toBe('Cash 5,000 + Bank 20,000')
    expect(payLabel(orders[0] as never)).toBe('Cash 5,000 + Bank 20,000')
    expect(payLabel(orders[1] as never)).toBe('M-Pesa')
  })

  it('posts one debit per part, balanced', () => {
    const lines = buildPosSaleLines({
      total: 25000,
      subtotal: 25000,
      tax: 0,
      orderRef: 'POS/0101',
      paymentMethod: 'bank',
      tenders: [{ method: 'cash', amount: 5000 }, { method: 'bank', amount: 20000, bankAccountId: 'ncba' }],
    })
    const debits = lines.filter(l => Number(l.debit) > 0)
    expect(debits.map(l => [l.cashBankAccountId, l.debit])).toEqual([['cash', 5000], ['ncba', 20000]])
    const dr = lines.reduce((a, l) => a + Number(l.debit || 0), 0)
    const cr = lines.reduce((a, l) => a + Number(l.credit || 0), 0)
    expect(dr).toBe(cr)
  })

  it('refuses a split that does not add up', () => {
    expect(() => buildPosSaleLines({
      total: 25000, subtotal: 25000, tax: 0, orderRef: 'POS/0102', paymentMethod: 'bank',
      tenders: [{ method: 'cash', amount: 5000 }, { method: 'bank', amount: 10000 }],
    })).toThrow(/do not add up/)
  })

  it('splits only what is left after client credit', () => {
    const lines = buildPosSaleLines({
      total: 25000, subtotal: 25000, tax: 0, customerCreditAmount: 5000, orderRef: 'POS/0103', paymentMethod: 'cash',
      tenders: [{ method: 'cash', amount: 5000 }, { method: 'mpesa', amount: 15000 }],
    })
    expect(lines.filter(l => Number(l.debit) > 0).map(l => Number(l.debit))).toEqual([5000, 15000, 5000])
  })
})
