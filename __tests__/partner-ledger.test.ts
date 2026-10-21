import { describe, expect, it } from 'vitest'
import { buildPartnerLedger, buildPartnerSummaries, belongsToPartner, type LedgerDoc } from '@/lib/accounting/partner-ledger'

const inv = (o: Partial<LedgerDoc>): LedgerDoc => ({
  id: o.ref ?? 'x', ref: 'INV/1', type: 'customer_invoice', status: 'posted', partnerId: 'c1', partnerName: 'Acme',
  date: '2026-09-01', dueDate: '2026-09-15', total: 1000, amountPaid: 0, payments: [], ...o,
})

describe('partner ledger', () => {
  it('leaves drafts off the ledger but counts them', () => {
    const l = buildPartnerLedger({ docs: [inv({ ref: 'INV/1' }), inv({ ref: 'DRAFT/2', status: 'draft', total: 500 })], side: 'customer', asOf: '2026-10-01' })
    expect(l.closing).toBe(1000)
    expect(l.drafts).toEqual({ count: 1, total: 500 })
  })

  it('opening balance, period totals and closing', () => {
    const docs = [
      inv({ ref: 'INV/1', date: '2026-08-01', amountPaid: 400, payments: [{ amount: 400, date: '2026-08-10', method: 'mpesa' }] }),
      inv({ ref: 'INV/2', date: '2026-09-05', dueDate: '2026-09-20', total: 2000, amountPaid: 2000, payments: [{ amount: 2000, date: '2026-09-25', method: 'bank_transfer' }] }),
    ]
    const l = buildPartnerLedger({ docs, side: 'customer', from: '2026-09-01', to: '2026-09-30' })
    expect(l.opening).toBe(600)
    expect(l.periodCharges).toBe(2000)
    expect(l.periodPayments).toBe(2000)
    expect(l.closing).toBe(600)
    expect(l.lines.map(x => x.kind)).toEqual(['invoice', 'payment'])
  })

  it('ages open items and splits overdue', () => {
    const docs = [
      inv({ ref: 'INV/1', dueDate: '2026-06-01', total: 300 }),
      inv({ ref: 'INV/2', dueDate: '2026-09-20', total: 200 }),
      inv({ ref: 'INV/3', dueDate: '2026-10-30', total: 100 }),
    ]
    const l = buildPartnerLedger({ docs, side: 'customer', asOf: '2026-10-01' })
    expect(l.outstanding).toBe(600)
    expect(l.overdue).toBe(500)
    expect(l.aging).toMatchObject({ current: 100, d1_30: 200, d90: 300 })
  })

  it('a supplier credit note lowers what we owe once, not twice', () => {
    const docs: LedgerDoc[] = [
      inv({ ref: 'BILL/1', type: 'vendor_bill', partnerId: 'v1', total: 50000, amountPaid: 26000, payments: [{ amount: 26000, method: 'vendor_credit', reference: 'VCN/1' }] }),
      inv({ ref: 'VCN/1', type: 'vendor_bill', partnerId: 'v1', total: -26000, amountPaid: -26000 }),
    ]
    const l = buildPartnerLedger({ docs, side: 'supplier', asOf: '2026-10-01' })
    expect(l.closing).toBe(24000)
    expect(l.outstanding).toBe(24000)
    expect(l.unappliedCredit).toBe(0)
    expect(l.lines.find(x => x.kind === 'credit_applied')?.payment).toBe(0)
  })

  it('a cancelled paid invoice leaves the payment as credit in the customer’s favour', () => {
    const docs = [inv({ ref: 'INV/1', status: 'cancelled', amountPaid: 1000, payments: [{ amount: 1000, method: 'cash' }] })]
    const l = buildPartnerLedger({ docs, side: 'customer' })
    expect(l.closing).toBe(-1000)
    expect(l.outstanding).toBe(0)
  })

  it('skips an unpaid cancelled invoice entirely', () => {
    const l = buildPartnerLedger({ docs: [inv({ status: 'cancelled' })], side: 'customer' })
    expect(l.lines).toHaveLength(0)
  })

  it('flags uncleared cheques', () => {
    const l = buildPartnerLedger({ docs: [inv({ amountPaid: 1000, payments: [{ amount: 1000, method: 'cheque', cleared: false }] })], side: 'customer' })
    expect(l.uncleared).toEqual({ count: 1, total: 1000 })
  })

  it('matches by id, not by part of a name', () => {
    expect(belongsToPartner({ partnerId: 'c2', partnerName: 'Brian Ogango' }, { id: 'c1', name: 'Brian' })).toBe(false)
    expect(belongsToPartner({ partnerId: null, partnerName: 'Brian Ogango' }, { name: 'Brian' })).toBe(false)
    expect(belongsToPartner({ partnerId: null, partnerName: 'Brian Ogango' }, { name: 'brian ogango' })).toBe(true)
  })

  it('summaries: one row per customer and per supplier, biggest balance first', () => {
    const rows = buildPartnerSummaries([
      inv({ ref: 'INV/1', total: 100 }),
      inv({ ref: 'INV/2', partnerId: 'c2', partnerName: 'Beta', total: 900 }),
      inv({ ref: 'BILL/1', type: 'vendor_bill', partnerId: 'c1', total: 50 }),
    ], '2026-10-01')
    expect(rows.map(r => `${r.side}:${r.name}:${r.outstanding}`)).toEqual(['customer:Beta:900', 'customer:Acme:100', 'supplier:Acme:50'])
  })
})
