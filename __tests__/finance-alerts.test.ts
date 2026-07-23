import { describe, it, expect } from 'vitest'
import { buildFinanceAlerts, computeCashbookTotals, cashPositionFromTotals } from '@/lib/finance-alerts'

const bank = (id: string, opening = 0, active = true) => ({ id, name: id.toUpperCase(), active, openingBalance: opening })

describe('computeCashbookTotals / cashPositionFromTotals', () => {
  it('applies opening balances plus credits minus debits', () => {
    const totals = computeCashbookTotals(
      [bank('ncba', 1000), bank('cash', 500)],
      [
        { bankAccountId: 'ncba', credit: 300, debit: 100 },
        { bankAccountId: 'cash', credit: 0, debit: 700 },
        { bankAccountId: 'unknown', credit: 999, debit: 0 }, // ignored
      ],
    )
    expect(totals.ncba).toBe(1200)
    expect(totals.cash).toBe(-200)
    const { cashAtBank, cashInHand } = cashPositionFromTotals(totals)
    expect(cashAtBank).toBe(1200) // ncba + equity + kcb
    expect(cashInHand).toBe(-200) // cash + mpesa
  })
})

describe('buildFinanceAlerts', () => {
  const base = { invoices: [], expenses: [], payrollRuns: [], bankStatementLines: [], bankAccounts: [], cashbookTotals: {} }

  it('returns nothing when everything is clean', () => {
    expect(buildFinanceAlerts(base)).toEqual([])
  })

  it('flags overdue customer invoices by due date, severity first', () => {
    const alerts = buildFinanceAlerts({
      ...base,
      invoices: [
        { type: 'customer_invoice', status: 'posted', total: 1000, amountPaid: 0, dueDate: '2020-01-01' },
        { type: 'customer_invoice', status: 'paid', total: 500, amountPaid: 500, dueDate: '2020-01-01' }, // paid — not flagged
      ],
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ tone: 'danger', path: '/finance?tab=invoices' })
    expect(alerts[0].title).toContain('1 overdue customer invoice')
    expect(alerts[0].sub).toContain('1,000')
  })

  it('flags overdue and open supplier bills separately', () => {
    const alerts = buildFinanceAlerts({
      ...base,
      invoices: [
        { type: 'vendor_bill', status: 'posted', total: 1500, amountPaid: 0, dueDate: '2020-01-01' },
        { type: 'vendor_bill', status: 'posted', total: 3000, amountPaid: 0, dueDate: '2099-01-01' },
      ],
    })
    const keys = alerts.map(a => a.key)
    expect(keys).toContain('fin-overdue-bills')
    expect(keys).toContain('fin-open-bills')
  })

  it('flags reimbursements due, payroll approvals, reconciliation backlog, and negative cash', () => {
    const alerts = buildFinanceAlerts({
      invoices: [],
      expenses: [{ reimbursable: true, status: 'approved', reimbursementStatus: 'pending', amount: 3810 }],
      payrollRuns: [{ status: 'pending_approval' }],
      bankStatementLines: [{ status: 'unmatched' }],
      bankAccounts: [bank('cash', -100)],
      cashbookTotals: { cash: -100 },
    })
    const keys = alerts.map(a => a.key)
    expect(keys).toEqual(expect.arrayContaining(['fin-reimbursements', 'fin-payroll', 'fin-unreconciled', 'fin-negative-cash']))
    const reimb = alerts.find(a => a.key === 'fin-reimbursements')!
    expect(reimb.sub).toContain('3,810')
    // negative cash is danger and sorts first
    expect(alerts[0].key).toBe('fin-negative-cash')
  })
})
