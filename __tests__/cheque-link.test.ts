import { describe, expect, it } from 'vitest'
import { chequeDirectionForDoc, chequeLinkedType, docBalance, findDocByRef, openDocsForCheque } from '@/lib/cheques/cheque-link'

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
