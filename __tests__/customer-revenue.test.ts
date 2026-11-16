import { describe, it, expect } from 'vitest'
import {
  customerRevenueFromInvoices, countsAsCustomerRevenue, invoiceRevenueValue,
} from '@/lib/dashboard/customer-revenue'

const inv = (over: Record<string, any> = {}) => ({
  id: 'i1', type: 'customer_invoice', status: 'posted', partnerId: 'c1', partnerName: 'Sumba Harun',
  date: '2026-11-04', total: 56000, ...over,
})

describe('what counts as customer revenue', () => {
  it('takes a posted customer invoice', () => {
    expect(countsAsCustomerRevenue(inv())).toBe(true)
  })

  it('leaves out drafts, cancellations, purchases and carried-over balances', () => {
    expect(countsAsCustomerRevenue(inv({ status: 'draft' }))).toBe(false)
    expect(countsAsCustomerRevenue(inv({ status: 'cancelled' }))).toBe(false)
    expect(countsAsCustomerRevenue(inv({ type: 'vendor_bill' }))).toBe(false)
    expect(countsAsCustomerRevenue(inv({ isOpeningBalance: true }))).toBe(false)
  })

  it('subtracts a credit note, stored negative or only flagged', () => {
    expect(invoiceRevenueValue(inv({ isCreditNote: true, total: 5000 }))).toBe(-5000)
    expect(invoiceRevenueValue(inv({ isCreditNote: true, total: -5000 }))).toBe(-5000)
    expect(invoiceRevenueValue(inv({ total: 5000 }))).toBe(5000)
  })
})

describe('ranking customers by invoice value', () => {
  it('counts every kind of invoice, not only the ones from a sale order', () => {
    const result = customerRevenueFromInvoices([
      inv({ id: 'a', saleOrderId: 'so1', total: 56000 }),
      inv({ id: 'b', repairId: 'r1', partnerId: 'c2', partnerName: 'Proactive Networks Ltd', total: 9000 }),
      inv({ id: 'c', isPosInvoice: true, partnerId: 'c3', partnerName: 'Walk-in Joy', total: 3000 }),
      inv({ id: 'd', partnerId: 'c2', partnerName: 'Proactive Networks Ltd', total: 48000 }),
    ])
    expect(result.rows[0]).toMatchObject({ name: 'Proactive Networks Ltd', revenue: 57000, orders: 2 })
    expect(result.total).toBe(116000)
    expect(result.customers).toBe(3)
  })

  it('nets a credit note off the customer it was issued to', () => {
    const result = customerRevenueFromInvoices([
      inv({ id: 'a', total: 56000 }),
      inv({ id: 'b', isCreditNote: true, total: 6000 }),
    ])
    expect(result.rows[0].revenue).toBe(50000)
  })

  it('keeps to the window it was given', () => {
    const result = customerRevenueFromInvoices([
      inv({ id: 'a', date: '2026-11-04', total: 10000 }),
      inv({ id: 'b', date: '2026-08-04', total: 90000 }),
    ], { months: new Set(['2026-10', '2026-11']) })
    expect(result.total).toBe(10000)
    expect(result.invoices).toBe(1)
  })

  it('says what the top leaves off', () => {
    const result = customerRevenueFromInvoices(
      [10, 9, 8, 7, 6, 5].map((n, i) => inv({ id: `i${i}`, partnerId: `c${i}`, partnerName: `C${i}`, total: n * 1000 })),
      { limit: 3 },
    )
    expect(result.shown).toBe(27000)
    expect(result.others).toBe(18000)
    expect(result.customers).toBe(6)
  })

  it('survives rubbish rows', () => {
    expect(customerRevenueFromInvoices(null).total).toBe(0)
    expect(customerRevenueFromInvoices([null, 'x', inv({ total: 'abc' })]).total).toBe(0)
  })
})
