import { describe, expect, it } from 'vitest'
import { computeDashboardInvoiceFigures, nairobiDay } from '@/lib/dashboard/invoice-figures'

const base = {
  today: '2026-11-11', // a Wednesday
  visibleSaleOrders: [{ id: 'so1' }],
  saleOrders: [],
  visibleRepairs: [{ id: 'r1', invoiceId: 'inv-r' }],
  deliveries: [],
  products: [],
  withInvoicedNotDelivered: false,
  withRecent: true,
  finance: null,
}

const inv = (o: Record<string, unknown>) => ({ type: 'customer_invoice', status: 'posted', total: 1000, amountPaid: 0, ...o })

describe('dashboard invoice figures', () => {
  it('buckets sale-order invoices by Nairobi month and counts this month', () => {
    const f = computeDashboardInvoiceFigures({
      ...base,
      invoices: [
        inv({ id: 'a', saleOrderId: 'so1', date: '2026-11-02', amountPaid: 400 }),
        inv({ id: 'b', saleOrderId: 'so1', date: '2026-10-15', amountPaid: 1000 }),
        inv({ id: 'c', saleOrderId: 'other', date: '2026-11-03', amountPaid: 1000 }),
        inv({ id: 'd', saleOrderId: 'so1', date: '2026-04-01', amountPaid: 1000 }), // older than six months
        inv({ id: 'e', saleOrderId: 'so1', date: '2026-11-04', status: 'draft' }),
      ],
    })
    expect(f.sales.invoicedValue).toBe(1000)
    expect(f.sales.collectedValue).toBe(400)
    expect(f.sales.monthlyCollected).toEqual([0, 0, 0, 0, 1000, 400])
    expect(f.sales.invoicedOrders).toBe(1)
    expect(f.sales.paidOrders).toBe(0)
  })

  it('sums paid revenue by period with a Monday week start', () => {
    const paid = (id: string, date: string) => inv({ id, date, amountPaid: 1000 })
    const f = computeDashboardInvoiceFigures({
      ...base,
      invoices: [
        paid('t', '2026-11-11'), paid('y', '2026-11-10'), paid('mon', '2026-11-09'),
        paid('sun', '2026-11-08'), paid('m', '2026-11-01'), paid('jan', '2026-01-05'),
        inv({ id: 'unpaid', date: '2026-11-11' }),
        { id: 'bill', type: 'vendor_bill', status: 'posted', total: 999, amountPaid: 999, date: '2026-11-11' },
      ],
    })
    expect(f.revenue).toEqual({ today: 1000, yesterday: 1000, week: 3000, month: 5000, year: 6000, paidThisWeekCount: 3 })
  })

  it('separates repair invoices from sales and lists this month\'s repair invoices', () => {
    const f = computeDashboardInvoiceFigures({
      ...base,
      invoices: [
        inv({ id: 'inv-r', date: '2026-11-05', amountPaid: 1000, subtotal: 862 }),
        inv({ id: 'sale', date: '2026-11-05', amountPaid: 1000 }),
      ],
    })
    expect(f.repairs.months[5]).toMatchObject({ revenue: 1000, count: 1, salesRevenue: 1000, salesCount: 1, repairInvoiced: 1000, repairCollected: 1000, repairOutstanding: 0 })
    expect(f.repairs.currentInvoices).toEqual([{ id: 'inv-r', total: 1000, subtotal: 862, linkedRepairIds: ['r1'] }])
  })

  it('keeps finance figures and recent invoices to what was asked for', () => {
    const f = computeDashboardInvoiceFigures({ ...base, withRecent: false, invoices: [inv({ id: 'a', date: '2026-11-05', ref: 'INV/1' })] })
    expect(f.recent).toEqual([])
    expect(f.financeDesk).toBeNull()
    const g = computeDashboardInvoiceFigures({ ...base, invoices: [inv({ id: 'a', date: '2026-11-05', ref: 'INV/1', partnerName: 'Acme' })] })
    expect(g.recent).toEqual([{ id: 'a', ref: 'INV/1', type: 'customer_invoice', partnerName: 'Acme', total: 1000, date: '2026-11-05' }])
  })

  it('reads timestamps as Nairobi days', () => {
    expect(nairobiDay('2026-11-10T22:30:00Z')).toBe('2026-11-11')
    expect(nairobiDay('2026-11-10')).toBe('2026-11-10')
    expect(nairobiDay('')).toBeNull()
  })
})
