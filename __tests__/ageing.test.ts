import { describe, expect, it } from 'vitest'
import { bucketForDays, bucketOpenInvoices, daysPastDue } from '@/lib/accounting/ageing'

describe('ageing helpers', () => {
  it('buckets days past due', () => {
    expect(bucketForDays(0)).toBe('current')
    expect(bucketForDays(15)).toBe('d30')
    expect(bucketForDays(45)).toBe('d60')
    expect(bucketForDays(75)).toBe('d90')
    expect(bucketForDays(120)).toBe('over90')
  })

  it('computes days past due from as-of date', () => {
    expect(daysPastDue('2026-07-01', new Date('2026-08-01'))).toBe(31)
    expect(daysPastDue('2026-08-10', new Date('2026-08-01'))).toBe(0)
  })

  it('builds AR/AP ageing rows and partner rollup', () => {
    const asOf = new Date('2026-08-01')
    const report = bucketOpenInvoices([
      {
        id: '1', ref: 'INV/1', partnerId: 'c1', partnerName: 'Acme',
        status: 'posted', date: '2026-04-01', dueDate: '2026-04-15',
        total: 10000, amountPaid: 2000,
      },
      {
        id: '2', ref: 'INV/2', partnerId: 'c1', partnerName: 'Acme',
        status: 'posted', date: '2026-07-20', dueDate: '2026-07-25',
        total: 5000, amountPaid: 0,
      },
      {
        id: '3', ref: 'INV/3', partnerId: 'c2', partnerName: 'Beta',
        status: 'posted', date: '2026-08-01', dueDate: '2026-08-15',
        total: 3000, amountPaid: 0,
      },
      {
        id: '4', ref: 'INV/4', partnerId: 'c3', partnerName: 'Paid',
        status: 'posted', date: '2026-01-01', dueDate: '2026-01-15',
        total: 1000, amountPaid: 1000,
      },
    ], asOf)

    expect(report.rows).toHaveLength(3)
    expect(report.totals.balance).toBe(16000)
    expect(report.partners).toHaveLength(2)
    const acme = report.partners.find(p => p.partnerId === 'c1')
    expect(acme?.invoiceCount).toBe(2)
    expect(acme?.balance).toBe(13000)
    expect(report.rows.find(r => r.ref === 'INV/3')?.bucket).toBe('current')
    expect(report.rows.find(r => r.ref === 'INV/1')?.bucket).toBe('over90')
  })
})
