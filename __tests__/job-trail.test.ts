import { describe, expect, it } from 'vitest'
import { buildJobTrail, type TrailData } from '@/lib/job-trail'

const data = (over: Partial<TrailData> = {}): TrailData => ({
  repairs: [{ id: 'r1', ref: 'REP/0101', status: 'ready', saleOrderId: 'so1', quote: { approvedDate: '2026-09-29' } }],
  saleOrders: [{ id: 'so1', ref: 'SO/0050', status: 'sale', repairId: 'r1' }],
  quotes: [{ id: 'q1', quoteNumber: 'QUO/0471', status: 'accepted', repairId: 'r1' }],
  invoices: [{ id: 'i1', ref: 'INV/0042', type: 'customer_invoice', status: 'posted', total: 10000, amountPaid: 4000, saleOrderId: 'so1', repairId: 'r1' }],
  deliveries: [],
  invoiceHref: id => `/finance?invoice=${id}`,
  ...over,
})

describe('the job trail', () => {
  it('follows a repair through quote, order, invoice and payment', () => {
    const { steps } = buildJobTrail({ kind: 'repair', id: 'r1' }, data())
    expect(steps.map(s => s.kind)).toEqual(['repair', 'quote', 'sale_order', 'invoice', 'payment'])
    expect(steps.find(s => s.kind === 'payment')?.status).toBe('KES 4,000 of 10,000')
  })

  it('finds the same trail starting from the invoice', () => {
    const { steps } = buildJobTrail({ kind: 'invoice', id: 'i1' }, data())
    expect(steps[0]).toMatchObject({ kind: 'repair', ref: 'REP/0101', href: '/repairs?id=r1' })
  })

  it('leaves out an invoice the repair replaced', () => {
    const d = data()
    d.repairs[0].previousInvoiceIds = ['i1']
    expect(buildJobTrail({ kind: 'repair', id: 'r1' }, d).steps.some(s => s.kind === 'invoice')).toBe(false)
  })
})

describe('the next step', () => {
  it('asks for the payment when the invoice is part-paid', () => {
    expect(buildJobTrail({ kind: 'repair', id: 'r1' }, data()).next).toMatchObject({ label: 'Record payment on INV/0042', tone: 'action' })
  })

  it('waits on the client while the quote is out', () => {
    const d = data({ repairs: [{ id: 'r1', ref: 'REP/0101', status: 'awaiting_approval', saleOrderId: 'so1' }] })
    expect(buildJobTrail({ kind: 'repair', id: 'r1' }, d).next).toMatchObject({ tone: 'waiting' })
  })

  it('asks for the invoice on a confirmed order with none', () => {
    const d = data({ invoices: [], repairs: [] })
    expect(buildJobTrail({ kind: 'sale_order', id: 'so1' }, d).next).toMatchObject({ label: 'Create the invoice', href: '/sales?id=so1' })
  })

  it('points at an open delivery once paid', () => {
    const d = data({
      repairs: [],
      invoices: [{ id: 'i1', ref: 'INV/0042', type: 'customer_invoice', status: 'posted', total: 10000, amountPaid: 10000, saleOrderId: 'so1' }],
      deliveries: [{ id: 'd1', ref: 'DN/0009', status: 'ready', saleOrderId: 'so1' }],
    })
    expect(buildJobTrail({ kind: 'sale_order', id: 'so1' }, d).next).toMatchObject({ label: 'Validate delivery DN/0009' })
  })
})
