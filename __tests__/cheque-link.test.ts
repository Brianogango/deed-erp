import { describe, expect, it } from 'vitest'
import { allocateCheque, chequeLinkedRefs, chequeDirectionForDoc, chequeLinkedType, docBalance, findDocByRef, openDocsForCheque } from '@/lib/cheques/cheque-link'

const doc = (over: Record<string, unknown>) => ({ id: String(over.ref), type: 'customer_invoice', status: 'posted', partnerName: 'Acme', total: 1000, amountPaid: 0, ...over }) as {
  id: string; ref: string; type: string; status: string; partnerName: string; total: number; amountPaid: number
}

describe('cheque ↔ invoice / bill links', () => {
  const docs = [
    doc({ ref: 'INV/2026/0001' }),
    doc({ ref: 'INV/2026/0002', amountPaid: 1000 }),
    doc({ ref: 'INV/2026/0003', status: 'draft' }),
    doc({ ref: 'BILL/2026/0007', type: 'vendor_bill', partnerName: 'Tokyo IT', total: 4700000, amountPaid: 700000 }),
  ]

  it('a customer invoice is paid with a cheque received, a bill with one given', () => {
    expect(chequeDirectionForDoc('customer_invoice')).toBe('received')
    expect(chequeDirectionForDoc('vendor_bill')).toBe('given')
    expect(chequeDirectionForDoc('customer_credit_note')).toBeNull()
    expect(chequeLinkedType('vendor_bill')).toBe('bill')
  })

  it('offers only posted documents with money still owing, of the right kind', () => {
    expect(openDocsForCheque(docs, 'received').map(d => d.ref)).toEqual(['INV/2026/0001'])
    expect(openDocsForCheque(docs, 'given').map(d => d.ref)).toEqual(['BILL/2026/0007'])
  })

  it('finds the document whatever the case or spacing, and knows what is owing', () => {
    const bill = findDocByRef(docs, ' bill/2026/0007 ')
    expect(bill?.partnerName).toBe('Tokyo IT')
    expect(docBalance(bill!)).toBe(4000000)
    expect(findDocByRef(docs, '')).toBeNull()
  })
})

describe('one cheque for several bills', () => {
  const bills = [
    { id: 'b2', ref: 'BILL/2026/0012', total: 50000, amountPaid: 0, date: '2026-10-05' },
    { id: 'b1', ref: 'BILL/2026/0010', total: 80000, amountPaid: 30000, date: '2026-10-01' },
  ]
  it('pays each bill in full when the cheque covers them all', () => {
    expect(allocateCheque(100000, bills).map(a => [a.doc.ref, a.amount])).toEqual([['BILL/2026/0010', 50000], ['BILL/2026/0012', 50000]])
  })
  it('pays the oldest first when the cheque is short', () => {
    expect(allocateCheque(70000, bills).map(a => a.amount)).toEqual([50000, 20000])
  })
  it('never records more than is owed', () => {
    expect(allocateCheque(250000, bills).reduce((s, a) => s + a.amount, 0)).toBe(100000)
  })
  it('keeps the register reference short', () => {
    expect(chequeLinkedRefs(['BILL/2026/0010', 'BILL/2026/0012'])).toBe('BILL/2026/0010, BILL/2026/0012')
    const many = Array.from({ length: 9 }, (_, i) => `BILL/2026/00${10 + i}`)
    const ref = chequeLinkedRefs(many)
    expect(ref.length).toBeLessThanOrEqual(80)
    expect(ref).toMatch(/\+\d+ more$/)
  })
})
