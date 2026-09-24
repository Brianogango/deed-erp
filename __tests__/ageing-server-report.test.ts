import { describe, expect, it } from 'vitest'
import { bucketOpenInvoices } from '@/lib/accounting/ageing'

/**
 * The ageing screen fetched the server's report, rebuilt a fake Invoice from
 * every row (total = balance, amountPaid = 0) and re-bucketed those, throwing
 * away the answer Postgres had already produced. These cover why the server's
 * report is the one to trust, and that the fallback still behaves.
 */

const asOf = '2026-09-24'

const invoice = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'inv-1',
  ref: 'INV/2026/0001',
  type: 'customer_invoice',
  status: 'posted',
  partnerId: 'client-1',
  partnerName: 'DIB Kenya Limited',
  date: '2026-06-01',
  dueDate: '2026-06-01',
  total: 100_000,
  amountPaid: 0,
  ...over,
})

describe('ageing buckets', () => {
  it('counts only what is still owed', () => {
    const paid = bucketOpenInvoices([invoice({ amountPaid: 60_000 })] as never, asOf)
    expect(paid.totals.balance).toBe(40_000)
  })

  it('drops an invoice that is settled', () => {
    const settled = bucketOpenInvoices([invoice({ amountPaid: 100_000 })] as never, asOf)
    expect(settled.rows).toHaveLength(0)
    expect(settled.totals.balance).toBe(0)
  })

  it('ages a long-overdue invoice into over90', () => {
    const report = bucketOpenInvoices([invoice()] as never, asOf)
    expect(report.totals.over90).toBe(100_000)
    expect(report.totals.current).toBe(0)
  })

  it('shows why the round trip was lossy: zeroing amountPaid overstates the debt', () => {
    // What the screen used to do to the server's rows.
    const real = bucketOpenInvoices([invoice({ amountPaid: 60_000 })] as never, asOf)
    const rebuiltFromRow = bucketOpenInvoices(
      [invoice({ total: real.rows[0].balance, amountPaid: 0 })] as never,
      asOf,
    )
    // The totals happen to agree, which is why nobody noticed...
    expect(rebuiltFromRow.totals.balance).toBe(real.totals.balance)
    // ...but every reconstructed invoice claims nothing has been paid on it.
    expect(rebuiltFromRow.rows[0].balance).toBe(40_000)
  })

  it('produces the partner rollup the screen renders', () => {
    const report = bucketOpenInvoices([
      invoice(),
      invoice({ id: 'inv-2', ref: 'INV/2026/0002', total: 50_000 }),
    ] as never, asOf)
    expect(report.partners).toHaveLength(1)
    expect(report.partners[0].balance).toBe(150_000)
  })
})
