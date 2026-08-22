import { describe, expect, it } from 'vitest'
import {
  attributedSales,
  closerIdOf,
  dateInInclusiveRange,
  isClosedSaleOrder,
  isRepCandidateRole,
  salesForCloser,
  salesVisibleToViewer,
  summarizeCloserSales,
} from '@/lib/sales/rep-sales'

describe('isClosedSaleOrder', () => {
  it('counts the Odoo sale stage and legacy closed statuses', () => {
    expect(isClosedSaleOrder('sale')).toBe(true)
    expect(isClosedSaleOrder('confirmed')).toBe(true)
    expect(isClosedSaleOrder('invoiced')).toBe(true)
    expect(isClosedSaleOrder('delivered')).toBe(true)
    expect(isClosedSaleOrder('quotation')).toBe(false)
    expect(isClosedSaleOrder('cancelled')).toBe(false)
  })
})

describe('attributedSales', () => {
  it('attributes POS and closed sale orders to the closer, falling back to cashier', () => {
    const sales = attributedSales({
      saleOrders: [
        { id: 'so1', ref: 'SO/0001', status: 'sale', date: '2026-08-22', total: 10000, salespersonId: 'joseph', salespersonName: 'Joseph', createdByUserId: 'cynthia', customerName: 'Acme' },
        { id: 'so2', ref: 'QUO/1', status: 'quotation', date: '2026-08-22', total: 999, salespersonId: 'joseph' },
      ],
      posOrders: [
        { id: 'p1', ref: 'POS/0039', date: '2026-08-22', total: 30001, salespersonId: 'joseph', salespersonName: 'Joseph Ndegwa Maina', createdByUserId: 'cynthia', customerName: 'Nm Engineering' },
        { id: 'p2', ref: 'POS/0032', date: '2026-08-19', total: 19500, createdByUserId: 'cynthia', createdByName: 'Cynthia Muthoki Juma', customerName: 'Catherine' },
      ],
    })
    expect(sales.map(s => [s.ref, s.closerId, s.total])).toEqual([
      ['SO/0001', 'joseph', 10000],
      ['POS/0039', 'joseph', 30001],
      ['POS/0032', 'cynthia', 19500],
    ])
  })

  it('summarises one closer in a date range', () => {
    const sales = attributedSales({
      posOrders: [
        { id: 'a', ref: 'POS/1', date: '2026-08-21', total: 12000, salespersonId: 'moses' },
        { id: 'b', ref: 'POS/2', date: '2026-07-01', total: 8000, salespersonId: 'moses' },
        { id: 'c', ref: 'POS/3', date: '2026-08-22', total: 26000, salespersonId: 'joseph' },
      ],
    })
    const moses = salesForCloser(sales, 'moses', '2026-08-01', '2026-08-31')
    expect(summarizeCloserSales(moses)).toEqual({ salesCount: 1, saleAmount: 12000 })
    expect(dateInInclusiveRange('2026-08-22T11:24:54.197Z', '2026-08-01', '2026-08-31')).toBe(true)
  })
})

describe('salesVisibleToViewer', () => {
  it('lets a sales rep see only tickets they closed or created', () => {
    const docs = [
      { id: '1', salespersonId: 'joseph', createdByUserId: 'cynthia' },
      { id: '2', salespersonId: 'moses', createdByUserId: 'cynthia' },
    ]
    expect(salesVisibleToViewer({ id: 'joseph', role: 'sales_rep' }, docs).map(d => d.id)).toEqual(['1'])
    expect(salesVisibleToViewer({ id: 'dir', role: 'director' }, docs)).toHaveLength(2)
    expect(salesVisibleToViewer({ id: 'tech', role: 'technician' }, docs)).toEqual([])
  })
})

describe('closer helpers', () => {
  it('prefers the chosen closer over the cashier', () => {
    expect(closerIdOf({ salespersonId: 'joseph', createdByUserId: 'cynthia' })).toBe('joseph')
    expect(isRepCandidateRole('admin_officer')).toBe(true)
    expect(isRepCandidateRole('technician')).toBe(false)
  })
})
