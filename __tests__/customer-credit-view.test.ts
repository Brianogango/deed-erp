import { describe, expect, it } from 'vitest'
import {
  creditBalancesByCustomer,
  creditsForCustomer,
  customerCreditBalance,
  customerCreditSourceLabel,
  customerCreditStatusLabel,
  isOpenCustomerCredit,
  totalOpenStoreCredit,
} from '@/lib/customer-credit-view'

const turaco = 'turaco-id'

const rows = [
  {
    id: '1',
    ref: 'CN/2026/0001',
    customerId: turaco,
    sourceType: 'buyback' as const,
    sourceBuyBackRef: 'BBK/2026/0004',
    amount: 35000,
    balance: 35000,
    status: 'available',
    createdAt: '2026-08-20',
  },
  {
    id: '2',
    ref: 'CN/2026/0002',
    customerId: turaco,
    sourceInvoiceRef: 'INV/2026/0010',
    amount: 5000,
    balance: 2000,
    status: 'partially_used',
    createdAt: '2026-08-19',
  },
  {
    id: '3',
    ref: 'CN/2026/0003',
    customerId: turaco,
    amount: 1000,
    balance: 1000,
    status: 'used',
    createdAt: '2026-08-18',
  },
  {
    id: '4',
    ref: 'CN/2026/0004',
    customerId: 'other',
    amount: 8000,
    balance: 8000,
    status: 'available',
    createdAt: '2026-08-17',
  },
]

describe('customer store credit view', () => {
  it('sums only open balances for that client', () => {
    expect(customerCreditBalance(rows, turaco)).toBe(37000)
    expect(customerCreditBalance(rows, 'other')).toBe(8000)
    expect(customerCreditBalance(rows, 'nobody')).toBe(0)
    expect(customerCreditBalance(rows, '')).toBe(0)
  })

  it('does not treat creditLimit-style used rows as spendable credit', () => {
    expect(isOpenCustomerCredit('used')).toBe(false)
    expect(isOpenCustomerCredit('void')).toBe(false)
    expect(isOpenCustomerCredit('available')).toBe(true)
  })

  it('lists a client newest first, including used notes', () => {
    const list = creditsForCustomer(rows, turaco)
    expect(list.map(c => c.ref)).toEqual(['CN/2026/0001', 'CN/2026/0002', 'CN/2026/0003'])
  })

  it('labels buy-back credits separately from invoice credits', () => {
    expect(customerCreditSourceLabel(rows[0])).toBe('Buy-back BBK/2026/0004')
    expect(customerCreditSourceLabel(rows[1])).toBe('Invoice INV/2026/0010')
    expect(customerCreditStatusLabel('partially_used')).toBe('Part used')
  })

  it('maps open balances by customer for list columns', () => {
    const map = creditBalancesByCustomer(rows)
    expect(map.get(turaco)).toBe(37000)
    expect(map.get('other')).toBe(8000)
    expect(map.has('nobody')).toBe(false)
  })

  it('totals open store credit across clients', () => {
    expect(totalOpenStoreCredit(rows)).toBe(45000)
  })
})
