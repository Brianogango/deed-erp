import { describe, it, expect } from 'vitest'
import {
  customerKey, customerRevenue, topCustomerRevenue, monthsInWindow, describeWindow,
  UNATTRIBUTED_KEY, UNATTRIBUTED_LABEL,
} from '@/lib/dashboard/sales-analytics'

describe('revenue by customer', () => {
  it('adds up every sale a customer made, not just the first', () => {
    const rows = customerRevenue([
      { customerId: 'c1', customerName: 'Sumba Harun', total: 56000 },
      { customerId: 'c1', customerName: 'Sumba Harun', total: 14000 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Sumba Harun', revenue: 70000, orders: 2 })
  })

  it('keeps a sale typed without a contact on that customer, by name', () => {
    const rows = customerRevenue([
      { customerId: 'c1', customerName: 'Zippie Nyawira', total: 47000 },
      { customerId: '', customerName: 'zippie  nyawira', total: 3000 },
    ])
    // Two records, two keys — an id and a name cannot be proven the same
    // customer — but neither is dropped and neither is merged into a blank.
    expect(rows.map(r => r.revenue).reduce((a, b) => a + b, 0)).toBe(50000)
    expect(rows.every(r => !r.unattributed)).toBe(true)
  })

  it('never lumps different nameless sales under one blank id', () => {
    const rows = customerRevenue([
      { customerId: '', customerName: 'Philis Waita', total: 47000 },
      { customerId: '', customerName: 'Eunice Were', total: 41500 },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.name)).toEqual(['Philis Waita', 'Eunice Were'])
  })

  it('shows a till sale with no customer as its own row instead of dropping it', () => {
    const rows = customerRevenue([
      { customerId: 'c1', customerName: 'Sumba Harun', total: 10000 },
      { total: 2500 },
      { customerId: '', customerName: '  ', total: 1500 },
    ])
    const walkIn = rows.find(r => r.key === UNATTRIBUTED_KEY)
    expect(walkIn).toMatchObject({ name: UNATTRIBUTED_LABEL, revenue: 4000, orders: 2, unattributed: true })
  })

  it('ranks biggest first and says what the top five leaves off', () => {
    const sales = [60, 50, 40, 30, 20, 10, 5].map((n, i) => ({ customerId: `c${i}`, customerName: `C${i}`, total: n * 1000 }))
    const result = topCustomerRevenue(sales, 5)
    expect(result.rows.map(r => r.revenue)).toEqual([60000, 50000, 40000, 30000, 20000])
    expect(result.total).toBe(215000)
    expect(result.shown).toBe(200000)
    expect(result.others).toBe(15000)
    expect(result.customers).toBe(7)
  })

  it('treats a missing or broken total as zero rather than NaN', () => {
    expect(customerRevenue([{ customerId: 'c1', customerName: 'A', total: Number.NaN }])[0].revenue).toBe(0)
  })

  it('keys by id first, then name, then nothing', () => {
    expect(customerKey({ customerId: 'c1', customerName: 'A', total: 0 })).toBe('id:c1')
    expect(customerKey({ customerName: 'A B', total: 0 })).toBe('name:a b')
    expect(customerKey({ total: 0 })).toBe(UNATTRIBUTED_KEY)
  })
})

describe('the reporting window', () => {
  it('covers the months up to and including the one chosen', () => {
    expect(monthsInWindow('2026-11', 1)).toEqual(['2026-11'])
    expect(monthsInWindow('2026-11', 3)).toEqual(['2026-09', '2026-10', '2026-11'])
  })

  it('crosses the turn of the year', () => {
    expect(monthsInWindow('2027-01', 3)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(monthsInWindow('2026-11', 12)[0]).toBe('2025-12')
  })

  it('reads as a month on its own, and a span when it is longer', () => {
    expect(describeWindow('2026-11', 1)).toBe('November 2026')
    expect(describeWindow('2026-11', 6)).toBe('Jun 26 – Nov 26')
    expect(describeWindow('', 6)).toBe('')
  })
})
