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
      role: 'technical_lead',
      repairs: [{ id: 'r1', ref: 'REP/1', status: 'received', intakeDate: '2026-10-01' }],
      stockAdjustments: [{ id: 'a1', ref: 'ADJ/1', status: 'pending', type: 'add', qty: 1, productName: 'X', requestedBy: 'Y', date: '2026-10-01' }, { id: 'a2', ref: 'ADJ/2', status: 'pending', type: 'add', qty: 1, productName: 'X', requestedBy: 'Y', date: '2026-10-01' }],
    })
    expect(ids(input)).toEqual(['unassigned-repairs', 'adjustments'])
  })

  // A Director used to match every queue, so the page filled with work other
  // people do and left out the decisions only a Director can make.
  describe('what is blocked on the person, not what their role could see', () => {
    const operational = () => ({
      repairs: [
        { id: 'r1', ref: 'REP/1', status: 'received', intakeDate: '2026-10-01' },
        { id: 'r2', ref: 'REP/2', status: 'awaiting_parts', procurementRequests: [{ id: 'p1', status: 'pending', requestedDate: '2026-10-01', items: [{ qty: '1', description: 'Screen' }] }] },
      ],
      serials: [{ id: 's1', serial: 'SN1', productName: 'HP 840', location: 'pending_testing', status: 'available', receivedDate: '2026-09-30' }],
      purchaseOrders: [{ id: 'po1', ref: 'PO/1', status: 'confirmed', vendorName: 'V', total: 1000, date: '2026-09-20' }],
      deliveries: [{ id: 'd1', ref: 'DN/1', status: 'ready', saleOrderId: 'so1', date: '2026-09-30' }],
    })

    it('keeps a Director out of work that belongs to someone else', () => {
      expect(ids(base({ role: 'director', ...operational() }))).toEqual([])
    })

    it('still gives those queues to the people who do them', () => {
      expect(ids(base({ role: 'technical_lead', ...operational() }))).toContain('unassigned-repairs')
      expect(ids(base({ role: 'inventory_officer', ...operational() }))).toContain('po-to-receive')
    })

    it('gives a Director the approvals that are waiting on them', () => {
      const queues = buildMyWork(base({
        role: 'director',
        approvalRequests: [{
          id: 'ar1', ref: 'APR/1', type: 'discount', documentType: 'sales_order', documentId: 'so1',
          documentRef: 'SO/1', requestedByName: 'Jane', requestedDate: '2026-10-01', status: 'pending',
          currentLevel: 1, approvers: [{ level: 1, role: 'director', approverIds: [] }],
          details: { reason: '15% off' },
        }],
      }))
      const q = queues.find(x => x.id === 'approvals-mine')!
      expect(q.count).toBe(1)
      expect(q.items[0]).toMatchObject({ title: 'SO/1', href: '/sales?id=so1' })
    })

    it('leaves out an approval that is waiting on somebody else', () => {
      const request = {
        id: 'ar1', ref: 'APR/1', type: 'discount', documentType: 'sales_order', documentId: 'so1',
        documentRef: 'SO/1', requestedByName: 'Jane', requestedDate: '2026-10-01', status: 'pending',
        currentLevel: 1, approvers: [{ level: 1, role: 'finance_officer', approverIds: ['u-9'] }],
        details: { reason: '15% off' },
      }
      expect(ids(base({ role: 'sales_rep', userId: 'u-1', approvalRequests: [request] }))).not.toContain('approvals-mine')
    })

    it('gives a Director the claims to review and the money to release', () => {
      const queues = buildMyWork(base({
        role: 'director',
        expenses: [
          { id: 'e1', ref: 'EXP/1', status: 'submitted', submittedByName: 'Sam', amount: 4500, description: 'Fuel', submittedDate: '2026-10-01' },
          { id: 'e2', ref: 'EXP/2', status: 'approved', submittedByName: 'Sam', amount: 9000, description: 'Courier', submittedDate: '2026-09-25', reviewedDate: '2026-09-26' },
          { id: 'e3', ref: 'EXP/3', status: 'paid', submittedByName: 'Sam', amount: 100, submittedDate: '2026-09-01' },
        ],
        invoices: [
          { id: 'b1', ref: 'BILL/1', type: 'vendor_bill', status: 'posted', partnerName: 'Supplier Ltd', total: 50000, amountPaid: 0, dueDate: '2026-09-30' },
          { id: 'b2', ref: 'BILL/2', type: 'vendor_bill', status: 'posted', partnerName: 'Not Due Ltd', total: 50000, amountPaid: 0, dueDate: '2026-12-30' },
          { id: 'b3', ref: 'BILL/3', type: 'vendor_bill', status: 'posted', partnerName: 'Settled Ltd', total: 50000, amountPaid: 50000, dueDate: '2026-09-30' },
          { id: 'b4', ref: 'BILL/4', type: 'vendor_bill', status: 'draft', partnerName: 'Draft Ltd', total: 50000, amountPaid: 0, dueDate: '2026-09-30' },
        ],
      }))
      expect(queues.find(q => q.id === 'expense-claims')!.items.map(i => i.title)).toEqual(['EXP/1'])
      const pay = queues.find(q => q.id === 'payments-due')!
      // Oldest first: the claim approved on the 26th, then the bill due on the 30th.
      // Not due, already settled and still draft are all left out.
      expect(pay.items.map(i => i.title)).toEqual(['EXP/2', 'BILL/1'])
      expect(pay.items[1].subtitle).toContain('KES 50,000 due')
    })

    it('does not ask a technician to release payments', () => {
      expect(ids(base({
        role: 'technician',
        expenses: [{ id: 'e2', ref: 'EXP/2', status: 'approved', amount: 10, submittedDate: '2026-09-25' }],
      }))).not.toContain('payments-due')
    })
  })
})
