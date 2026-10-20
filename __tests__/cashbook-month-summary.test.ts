import { describe, expect, it } from 'vitest'
import { buildCashbookMonthSummary } from '@/lib/accounting/cashbook-summary'

const accounts = [
  { id: 'mpesa', label: 'M-Pesa', openingBalance: 1000 },
  { id: 'ncba', label: 'NCBA', openingBalance: 0 },
]
const sale = (date: string, bank: string, lines: Array<[string, string, number]>) => ({
  date, bankAccountId: bank, debit: 0, credit: lines.reduce((s, l) => s + l[2], 0), sourceType: 'customer_invoice', category: '',
  salesLines: lines.map(([code, name, amount]) => ({ code, name, amount })),
})
const entries = [
  sale('2026-09-30', 'mpesa', [['5001', 'Laptops', 500]]),
  sale('2026-10-02', 'mpesa', [['5001', 'Laptops', 40000], ['5002', 'Accessories', 2000]]),
  sale('2026-10-05', 'ncba', [['5003', 'Desktop / Combo', 30000]]),
  { date: '2026-10-06', bankAccountId: 'ncba', debit: 0, credit: 5000, sourceType: 'pos', category: 'Sales Revenue' },
  { date: '2026-10-07', bankAccountId: 'mpesa', debit: 0, credit: 3000, sourceType: 'deposit', category: 'Customer Deposits' },
  { date: '2026-10-08', bankAccountId: 'ncba', debit: 20000, credit: 0, sourceType: 'vendor_bill', category: 'Payables' },
  { date: '2026-10-09', bankAccountId: 'mpesa', debit: 300, credit: 0, sourceType: 'expense', category: 'Fuel and Transport' },
  { date: '2026-10-10', bankAccountId: 'mpesa', debit: 200, credit: 0, sourceType: 'expense', category: 'Fuel and Transport' },
  sale('2026-11-01', 'mpesa', [['5001', 'Laptops', 99999]]),
]

describe('cashbook month summary', () => {
  const s = buildCashbookMonthSummary({ entries, month: '2026-10', bankAccounts: accounts })

  it('opening carries everything before the month', () => {
    expect(s.opening).toBe(1500)
  })
  it('sales by product line, biggest first; unsplit sales are Other sales', () => {
    expect(s.sales.map(r => [r.label, r.amount])).toEqual([
      ['Laptops', 40000], ['Desktop / Combo', 30000], ['Other sales', 5000], ['Accessories', 2000],
    ])
    expect(s.salesTotal).toBe(77000)
  })
  it('deposits are money in but not sales', () => {
    expect(s.otherIn).toEqual([{ key: 'deposit', label: 'Customer deposits', amount: 3000, count: 1 }])
    expect(s.moneyIn).toBe(80000)
  })
  it('money out by kind; expenses by their account', () => {
    expect(s.moneyOutRows.map(r => [r.label, r.amount, r.count])).toEqual([
      ['Supplier payments', 20000, 1], ['Fuel and Transport', 500, 2],
    ])
    expect(s.moneyOut).toBe(20500)
  })
  it('closing = opening + in − out, per account too', () => {
    expect(s.closing).toBe(1500 + 80000 - 20500)
    const mpesa = s.accounts.find(a => a.id === 'mpesa')!
    expect(mpesa).toMatchObject({ opening: 1500, moneyIn: 45000, moneyOut: 500, closing: 46000 })
  })
  it('one account only', () => {
    const n = buildCashbookMonthSummary({ entries, month: '2026-10', bankAccounts: accounts, accountId: 'ncba' })
    expect(n.moneyIn).toBe(35000)
    expect(n.accounts.map(a => a.id)).toEqual(['ncba'])
  })
})
