import { describe, expect, it } from 'vitest'
import { buildMyWork, type MyWorkInput } from '@/lib/my-work'

const NOW = new Date('2026-10-04T08:00:00Z')
const base = (over: Partial<MyWorkInput> = {}): MyWorkInput => ({
  role: 'director', userId: 'u-1', now: NOW,
  repairs: [], saleOrders: [], invoices: [], deliveries: [], buyBacks: [],
  stockAdjustments: [], serials: [], purchaseOrders: [],
  invoiceHref: id => `/finance?invoice=${id}`,
  ...over,
})
const ids = (input: MyWorkInput) => buildMyWork(input).map(q => q.id)

describe('My work', () => {
  it('shows a technician only their own repairs', () => {
    const repairs = [
      { id: 'r1', ref: 'REP/1', status: 'in_repair', assignedTechnicianId: 'u-1', intakeDate: '2026-10-01' },
      { id: 'r2', ref: 'REP/2', status: 'in_repair', assignedTechnicianId: 'u-2', intakeDate: '2026-10-01' },
    ]
    const queues = buildMyWork(base({ role: 'technician', repairs }))
    expect(queues.map(q => q.id)).toEqual(['my-repairs'])
    expect(queues[0].items.map(i => i.title)).toEqual(['REP/1'])
  })

  it('gives Finance the invoices to reissue, draft invoices and overdue balances', () => {
    const input = base({
      role: 'finance_officer',
      repairs: [{ id: 'r1', ref: 'REP/1', status: 'approved', invoiceReissue: { status: 'pending', invoiceRef: 'INV/9', previousTotal: 1, revisedTotal: 2, raisedAt: '2026-10-01' } }],
      invoices: [
        { id: 'i1', ref: 'INV/1', type: 'customer_invoice', status: 'draft', total: 100, date: '2026-10-02' },
        { id: 'i2', ref: 'INV/2', type: 'customer_invoice', status: 'posted', total: 100, amountPaid: 0, dueDate: '2026-09-01' },
      ],
    })
    expect(ids(input)).toEqual(expect.arrayContaining(['invoice-reissue', 'draft-invoices', 'overdue-invoices']))
    expect(ids(input)).not.toContain('parts-requests')
  })

  it('gives inventory the parts requests and devices awaiting tests', () => {
    const input = base({
      role: 'inventory',
      repairs: [{ id: 'r1', ref: 'REP/1', status: 'awaiting_parts', procurementRequests: [{ id: 'p1', status: 'pending', requestedDate: '2026-10-01', items: [{ qty: '1', description: 'Screen' }] }] }],
      serials: [{ id: 's1', serial: 'SN1', productName: 'HP 840', location: 'pending_testing', status: 'available', receivedDate: '2026-09-30' }],
    })
    const queues = buildMyWork(input)
    expect(queues.map(q => q.id)).toEqual(expect.arrayContaining(['parts-requests', 'awaiting-tests']))
    expect(queues.find(q => q.id === 'parts-requests')!.items[0].subtitle).toBe('1 × Screen')
  })

  it('chases quotes the client has sat on for three days, not newer ones', () => {
    const repairs = [
      { id: 'old', ref: 'REP/OLD', status: 'awaiting_approval', quote: { sentDate: '2026-09-28', total: 5000 } },
      { id: 'new', ref: 'REP/NEW', status: 'awaiting_approval', quote: { sentDate: '2026-10-03', total: 5000 } },
    ]
    const q = buildMyWork(base({ role: 'admin_officer', repairs })).find(x => x.id === 'quotes-unanswered')!
    expect(q.items.map(i => i.title)).toEqual(['REP/OLD'])
  })

  it('leaves out empty queues and puts urgent ones first', () => {
    const input = base({
      role: 'director',
      repairs: [{ id: 'r1', ref: 'REP/1', status: 'received', intakeDate: '2026-10-01' }],
      stockAdjustments: [{ id: 'a1', ref: 'ADJ/1', status: 'pending', type: 'add', qty: 1, productName: 'X', requestedBy: 'Y', date: '2026-10-01' }, { id: 'a2', ref: 'ADJ/2', status: 'pending', type: 'add', qty: 1, productName: 'X', requestedBy: 'Y', date: '2026-10-01' }],
    })
    expect(ids(input)).toEqual(['unassigned-repairs', 'adjustments'])
  })
})
