import { describe, expect, it } from 'vitest'
import {
  cleanVendorExpenseAccounts, goesToPurchases, isOperatingExpenseCode, overheadLinesInPurchases, suggestExpenseAccount,
} from '@/lib/accounting/bill-expense-accounts'
import { recurringFromBill } from '@/lib/recurring/recurring-from-bill'
import { recurringBillReminders, type RecurringBill } from '@/lib/recurring/recurring-bills'

describe('which account a bill line lands in', () => {
  it('blank and cost-of-sales accounts are Purchases; 6401+ are operating expenses', () => {
    expect(goesToPurchases('')).toBe(true)
    expect(goesToPurchases('6101')).toBe(true)
    expect(goesToPurchases('6307')).toBe(true)
    expect(goesToPurchases('6508')).toBe(false)
    expect(isOperatingExpenseCode('6508')).toBe(true)
    expect(isOperatingExpenseCode('6101')).toBe(false)
  })

  it('warns only for vendors that do not supply stock', () => {
    const lines = [{ accountCode: '' }, { accountCode: '6508' }, { accountCode: '', lineType: 'section' }]
    expect(overheadLinesInPurchases(lines, false)).toHaveLength(1)
    expect(overheadLinesInPurchases(lines, true)).toHaveLength(0)
  })

  it('suggests the usual account from the description or vendor', () => {
    expect(suggestExpenseAccount('Office rent October')).toBe('6508')
    expect(suggestExpenseAccount('Tokens', 'KPLC')).toBe('6506')
    expect(suggestExpenseAccount('Monthly fibre', 'Safaricom')).toBe('6510')
    expect(suggestExpenseAccount('HP laptops x5')).toBeUndefined()
  })

  it('keeps only real ids with 6xxx codes in the stored map', () => {
    expect(cleanVendorExpenseAccounts({ a: '6508', b: '1200', c: '', ' ': '6506' })).toEqual({ a: '6508' })
    expect(cleanVendorExpenseAccounts([])).toEqual({})
  })
})

describe('repeat this bill', () => {
  const base = {
    vendorId: 'v1', vendorName: 'Landlord Ltd', billDate: '2026-10-05', frequency: 'monthly' as const, vatRate: 0,
    lines: [
      { lineType: 'section', description: 'Premises', subtotal: 0 },
      { lineType: 'item', description: 'Office rent', accountCode: '6508', subtotal: 50000, taxRate: 16 },
      { lineType: 'item', description: 'Service charge', accountCode: '6508', subtotal: 5000, taxRate: 16 },
    ],
  }
  it('copies the lines, amounts and bill day', () => {
    const t = recurringFromBill({ ...base, amountChanges: false })
    expect(t.title).toBe('Office rent')
    expect(t.dayOfMonth).toBe(5)
    expect(t.vatRate).toBe(16)
    expect(t.lines).toEqual([
      { description: 'Office rent', accountCode: '6508', amount: 50000 },
      { description: 'Service charge', accountCode: '6508', amount: 5000 },
    ])
  })
  it('leaves amounts blank when they change each time', () => {
    const t = recurringFromBill({ ...base, amountChanges: true })
    expect(t.lines.every(l => l.amount === null)).toBe(true)
  })
})

describe('recurring bill reminders', () => {
  const t: RecurringBill = {
    id: 'r1', ref: 'RB/0001', vendorId: 'v1', vendorName: 'KPLC', title: 'Electricity', frequency: 'monthly',
    dayOfMonth: 10, startDate: '2026-09-10', vatRate: 0, paused: false, createdAt: '2026-09-01',
    lines: [{ description: 'Power', accountCode: '6506', amount: null }],
    generated: [{ period: '2026-09', invoiceId: 'i1', invoiceRef: 'BILL/1', billDate: '2026-09-10' }],
  }
  const fmt = (n: number) => `KES ${n}`
  it('nothing before the bill day', () => {
    expect(recurringBillReminders([t], '2026-10-09', fmt)).toEqual([])
  })
  it('one reminder on the bill day, asking for the amount when it varies', () => {
    const [r] = recurringBillReminders([t], '2026-10-10', fmt)
    expect(r.period).toBe('2026-10')
    expect(r.body).toMatch(/amount changes/)
  })
  it('none once the bill exists, or when paused', () => {
    const done = { ...t, generated: [...t.generated, { period: '2026-10', invoiceId: 'i2', invoiceRef: 'BILL/2', billDate: '2026-10-10' }] }
    expect(recurringBillReminders([done], '2026-10-15', fmt)).toEqual([])
    expect(recurringBillReminders([{ ...t, paused: true }], '2026-10-15', fmt)).toEqual([])
  })
  it('shows the fixed amount', () => {
    const rent = { ...t, title: 'Rent', lines: [{ description: 'Rent', accountCode: '6508', amount: 50000 }] }
    expect(recurringBillReminders([rent], '2026-10-10', fmt)[0].body).toMatch(/KES 50000/)
  })
})

describe('the month belongs to one bill only', () => {
  it('drops month names and years from a repeating bill', async () => {
    const { withoutPeriod } = await import('@/lib/recurring/recurring-from-bill')
    expect(withoutPeriod('Office rent October')).toBe('Office rent')
    expect(withoutPeriod('Internet - Oct 2026')).toBe('Internet')
    expect(withoutPeriod('Rent for November 2026')).toBe('Rent')
    expect(withoutPeriod('Electricity 2026-10')).toBe('Electricity')
    expect(withoutPeriod('Service charge Q4')).toBe('Service charge')
    expect(withoutPeriod('Security services')).toBe('Security services')
    expect(withoutPeriod('Marketing retainer')).toBe('Marketing retainer')
    expect(withoutPeriod('October')).toBe('October')
  })
})
