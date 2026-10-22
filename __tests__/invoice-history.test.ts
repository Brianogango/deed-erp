import { describe, expect, it } from 'vitest'
import { describeAuditRow, invoiceEditChanges, sortHistory, type AuditRow } from '@/lib/finance/invoice-history'

const names = (id: string | null) => (id === 'u1' ? 'Jane Finance' : id ? 'Unknown user' : null)
const row = (o: Record<string, any>): AuditRow => ({ id: '1', action: 'x', entityType: 'invoice', userId: 'u1', createdAt: '2026-10-21T08:15:00Z', oldValues: {}, newValues: {}, ...o })

describe('invoice edit changes', () => {
  it('lists each changed field in words', () => {
    const changes = invoiceEditChanges({
      before: { dueDate: new Date('2026-10-30'), totalAmount: 30000, notes: 'a', status: 'draft', paymentBlocked: false },
      data: { dueDate: new Date('2026-11-15'), totalAmount: 35300, notes: 'a', paymentBlocked: true },
    })
    expect(changes.map(c => `${c.label}: ${c.from} → ${c.to}`)).toEqual([
      'Due date: 2026-10-30 → 2026-11-15',
      'Payment: Open → Blocked (dispute)',
      'Total: KES 30,000 → KES 35,300',
    ])
  })

  it('names added and removed lines', () => {
    const changes = invoiceEditChanges({
      before: {},
      data: {},
      beforeLines: [{ description: 'Screen', qty: 1, unitPrice: 5000, taxRate: 0 }],
      afterLines: [{ description: 'Screen', qty: 1, unitPrice: 5000, taxRate: 0 }, { description: 'Battery', qty: 2, unitPrice: 3000, taxRate: 0 }],
    })
    expect(changes).toEqual([{ field: 'lines', label: 'Lines', from: '—', to: 'Battery ×2 @ KES 3,000' }])
  })

  it('a save that changed nothing has no changes', () => {
    expect(invoiceEditChanges({ before: { notes: 'x', status: 'approved' }, data: { notes: 'x', status: 'invoiced' } })).toEqual([])
  })
})

describe('history lines', () => {
  it('shows who created it', () => {
    const e = describeAuditRow(row({ action: 'create_invoice', newValues: { invoiceNumber: 'INV/1', totalAmount: 35300, status: 'draft' } }), 'Invoice', names)
    expect(e).toMatchObject({ title: 'Invoice created', by: 'Jane Finance', detail: 'INV/1 · KES 35,300 · Draft' })
  })

  it('hides background saves that changed nothing', () => {
    expect(describeAuditRow(row({ action: 'update_invoice', newValues: { changes: [] }, oldValues: { status: 'approved', totalAmount: 1 } }), 'Invoice', names)).toBeNull()
  })

  it('an edit carries its changes; a cancel reads as cancelled', () => {
    const edit = describeAuditRow(row({ action: 'update_invoice', newValues: { changes: [{ field: 'dueDate', label: 'Due date', from: 'a', to: 'b' }] } }), 'Bill', names)
    expect(edit).toMatchObject({ title: 'Bill edited', changes: [{ label: 'Due date' }] })
    const cancel = describeAuditRow(row({ action: 'update_invoice', newValues: { changes: [{ field: 'status', label: 'Status', from: 'Confirmed', to: 'Cancelled' }] } }), 'Bill', names)
    expect(cancel).toMatchObject({ title: 'Bill cancelled', tone: 'bad' })
  })

  it('payments and reversals', () => {
    expect(describeAuditRow(row({ action: 'record_invoice_payment', newValues: { paymentAmount: 35300, paymentMethod: 'mpesa', reference: 'UJL' } }), 'Invoice', names))
      .toMatchObject({ title: 'Receipt recorded', detail: 'KES 35,300 · mpesa · UJL' })
    expect(describeAuditRow(row({ action: 'reverse_invoice_payment', entityType: 'payment', oldValues: { amount: 100 }, newValues: { reason: 'Bounced' } }), 'Invoice', names))
      .toMatchObject({ title: 'Payment reversed', detail: 'KES 100 · Reason: Bounced', tone: 'bad' })
  })

  it('screen entries keep their details and the username; duplicates are dropped', () => {
    const e = describeAuditRow(row({ action: 'invoice_customer_corrected', entityType: 'document', userId: null, newValues: { details: 'Customer corrected: A → B', username: 'brian' } }), 'Invoice', names)
    expect(e).toMatchObject({ title: 'Customer corrected', by: 'brian', detail: 'Customer corrected: A → B' })
    expect(describeAuditRow(row({ action: 'post_invoice', entityType: 'document' }), 'Invoice', names)).toBeNull()
  })

  it('newest first', () => {
    const list = sortHistory([
      { id: 'a', at: '2026-10-21T08:00:00Z', action: 'x', title: 'old', by: null },
      { id: 'b', at: '2026-10-21T09:00:00Z', action: 'x', title: 'new', by: null },
    ])
    expect(list.map(e => e.title)).toEqual(['new', 'old'])
  })
})
