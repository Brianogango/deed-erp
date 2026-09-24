import { describe, expect, it } from 'vitest'
import { invoiceOutstanding, invoicePaidAmount } from '@/lib/accounting/invoice-paid'
import { computeInvoiceStats, type StatsInvoiceLike } from '@/lib/accounting/invoice-stats'

const today = '2026-09-25'

const inv = (over: Partial<StatsInvoiceLike> = {}): StatsInvoiceLike => ({
  type: 'customer_invoice',
  status: 'posted',
  total: 100_000,
  amountPaid: 0,
  date: '2026-09-24',
  dueDate: '2026-09-24',
  paymentBlocked: false,
  ...over,
})

const bill = (over: Partial<StatsInvoiceLike> = {}) => inv({ type: 'vendor_bill', ...over })

describe('invoicePaidAmount — the receivables inflation', () => {
  it('uses the itemised allocations when they exist', () => {
    expect(invoicePaidAmount({
      paymentAllocations: [{ amount: 30_000 }, { amount: 20_000 }],
      amountPaid: 0,
    })).toBe(50_000)
  })

  it('falls back to the cache for invoices settled before allocations existed', () => {
    // Summing zero allocation rows reported a fully settled invoice as
    // entirely unpaid, which inflated receivables by ~2M in production.
    expect(invoicePaidAmount({ paymentAllocations: [], amountPaid: 100_000 })).toBe(100_000)
    expect(invoicePaidAmount({ amountPaid: 100_000 })).toBe(100_000)
  })

  it('shows nothing outstanding on a legacy-paid invoice', () => {
    expect(invoiceOutstanding({
      totalAmount: 100_000, amountPaid: 100_000, paymentAllocations: [],
    })).toBe(0)
  })

  it('prefers allocations over a stale cache', () => {
    // A cache that disagrees with the allocations must not win.
    expect(invoiceOutstanding({
      totalAmount: 100_000, amountPaid: 100_000, paymentAllocations: [{ amount: 40_000 }],
    })).toBe(60_000)
  })

  it('never reports a negative balance', () => {
    expect(invoiceOutstanding({
      totalAmount: 100_000, paymentAllocations: [{ amount: 120_000 }],
    })).toBe(0)
  })
})

describe('computeInvoiceStats', () => {
  it('counts revenue only from fully paid invoices', () => {
    expect(computeInvoiceStats([inv({ amountPaid: 100_000 }), inv({ amountPaid: 40_000 })], today).revenue)
      .toBe(100_000)
  })

  it('counts outstanding from the residual, not the total', () => {
    expect(computeInvoiceStats([inv({ amountPaid: 40_000 })], today).outstanding).toBe(60_000)
  })

  it('counts only invoices past their due date as overdue', () => {
    const stats = computeInvoiceStats(
      [inv({ dueDate: '2026-09-01' }), inv({ dueDate: '2026-12-31' })],
      today,
    )
    expect(stats.overdueCount).toBe(1)
  })

  it('ignores drafts and cancelled documents', () => {
    expect(computeInvoiceStats([inv({ status: 'draft' }), inv({ status: 'cancelled' })], today))
      .toMatchObject({ outstanding: 0, overdueCount: 0, revenue: 0 })
  })

  it('keeps payables separate from receivables', () => {
    const stats = computeInvoiceStats(
      [inv(), bill({ total: 25_000 }), bill({ total: 75_000, amountPaid: 75_000 })],
      today,
    )
    expect(stats.outstanding).toBe(100_000)
    expect(stats.payables).toBe(25_000)
    expect(stats.pendingBillCount).toBe(1)
  })

  it('keeps a part-paid blocked invoice out of revenue and in outstanding', () => {
    // paymentBlocked only downgrades a document that still owes something:
    // invoicePaymentStatus returns 'blocked' when paid < total, and leaves a
    // fully settled invoice as 'paid' even when the flag is set.
    const stats = computeInvoiceStats([inv({ amountPaid: 40_000, paymentBlocked: true })], today)
    expect(stats.revenue).toBe(0)
    expect(stats.outstanding).toBe(60_000)
  })

  it('still counts a fully settled invoice as revenue when the flag is set', () => {
    expect(computeInvoiceStats([inv({ amountPaid: 100_000, paymentBlocked: true })], today).revenue)
      .toBe(100_000)
  })

  it('handles an empty or missing collection', () => {
    const zero = { revenue: 0, outstanding: 0, payables: 0, overdueCount: 0, pendingBillCount: 0 }
    expect(computeInvoiceStats([], today)).toEqual(zero)
    expect(computeInvoiceStats(null, today)).toEqual(zero)
  })
})

describe('server and browser equivalence', () => {
  it('gives the same answer whichever side maps the rows', () => {
    // The point of the shared function: the server maps database rows into
    // this shape, the browser passes its own invoices, and neither can drift.
    const asBrowserHasThem = [
      inv({ amountPaid: 40_000, dueDate: '2026-09-01' }),
      inv({ amountPaid: 100_000 }),
      bill({ total: 60_000 }),
    ]
    const asServerMapsThem = asBrowserHasThem.map(i => ({ ...i }))

    expect(computeInvoiceStats(asServerMapsThem, today))
      .toEqual(computeInvoiceStats(asBrowserHasThem, today))
  })

  it('differs only where the server knows more: allocations beat a stale cache', () => {
    const blobView = inv({ amountPaid: 0 })
    const serverView = {
      ...blobView,
      amountPaid: invoicePaidAmount({ paymentAllocations: [{ amount: 100_000 }], amountPaid: 0 }),
    }
    expect(computeInvoiceStats([blobView], today).outstanding).toBe(100_000)
    expect(computeInvoiceStats([serverView], today).outstanding).toBe(0)
  })
})
