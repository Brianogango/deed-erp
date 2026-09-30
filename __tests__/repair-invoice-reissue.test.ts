import { describe, expect, it } from 'vitest'
import {
  approvedQuoteOrderItems, fullCreditLines, invoiceReachedLedger, reissueAfterClientDecision,
  reissueBlocker, reissueOnRevision, type InvoiceReissue,
} from '@/lib/repair/invoice-reissue'

const posted = { id: 'inv-1', ref: 'INV/2026/0042', status: 'posted' }

describe('revising the quote on an invoiced job', () => {
  it('leaves a draft invoice to be updated in place', () => {
    expect(reissueOnRevision({ invoice: { ...posted, status: 'draft' }, previousTotal: 10000, revisedTotal: 13000, now: '2026-09-30' })).toBeNull()
  })

  it('holds a posted invoice until the client answers', () => {
    const r = reissueOnRevision({ invoice: posted, previousTotal: 10000, revisedTotal: 13000, now: '2026-09-30' })
    expect(r).toMatchObject({ status: 'awaiting_client', invoiceId: 'inv-1', invoiceRef: 'INV/2026/0042', previousTotal: 10000, revisedTotal: 13000 })
  })

  it('keeps the original figure when the quote is revised twice before approval', () => {
    const first = reissueOnRevision({ invoice: posted, previousTotal: 10000, revisedTotal: 13000, now: '2026-09-30' })
    const second = reissueOnRevision({ invoice: posted, previousTotal: 13000, revisedTotal: 12000, now: '2026-10-01', existing: first })
    expect(second).toMatchObject({ previousTotal: 10000, revisedTotal: 12000, raisedAt: '2026-09-30' })
  })

  it('ignores cancelled invoices and jobs with none', () => {
    expect(reissueOnRevision({ invoice: { ...posted, status: 'cancelled' }, previousTotal: 1, revisedTotal: 2, now: 'x' })).toBeNull()
    expect(reissueOnRevision({ invoice: null, previousTotal: 1, revisedTotal: 2, now: 'x' })).toBeNull()
  })
})

describe('the client answers', () => {
  const waiting = reissueOnRevision({ invoice: posted, previousTotal: 10000, revisedTotal: 13000, now: '2026-09-30' })!

  it('approval hands it to Finance', () => {
    expect(reissueAfterClientDecision(waiting, true, '2026-10-01')).toMatchObject({ status: 'pending', approvedAt: '2026-10-01' })
  })

  it('a decline leaves the original invoice standing', () => {
    const dropped = reissueAfterClientDecision(waiting, false, '2026-10-01')
    expect(dropped?.status).toBe('dropped')
    expect(reissueBlocker(dropped)).toBeNull()
  })

  it('blocks billing and release until Finance has reissued', () => {
    expect(reissueBlocker(waiting)).toContain('waiting for the client')
    expect(reissueBlocker(reissueAfterClientDecision(waiting, true, 'x'))).toContain('Finance must credit INV/2026/0042')
    expect(reissueBlocker({ ...waiting, status: 'credited' } as InvoiceReissue)).toBeNull()
  })
})

describe('what Finance reissues', () => {
  it('trusts the ledger, not the store, on whether an invoice is posted', () => {
    expect(invoiceReachedLedger({ postingStatus: 'posted' })).toBe(true)
    expect(invoiceReachedLedger({ postingStatus: 'unposted', postedJournalEntryId: 'j-1' })).toBe(true)
    expect(invoiceReachedLedger({ postingStatus: 'unposted', postedJournalEntryId: null })).toBe(false)
  })

  it('credits whatever of each line is not credited yet', () => {
    expect(fullCreditLines([{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }], { a: 1, b: 1 })).toEqual([{ invoiceItemId: 'a', qty: 1 }])
  })

  it('puts only the approved lines on the sale order, net of VAT', () => {
    const items = approvedQuoteOrderItems({
      subtotal: 12000, tax: 1920,
      lines: [
        { description: 'Screen', qty: 1, unitPrice: 9000, decision: 'approved', productId: 'p-1' },
        { description: 'Keyboard', qty: 1, unitPrice: 3000, decision: 'declined' },
        { description: 'Labour', qty: 1, unitPrice: 1500 },
      ],
    }, id => id === 'p-1')
    expect(items.map(i => i.description)).toEqual(['Screen', 'Labour'])
    expect(items[0]).toMatchObject({ taxRate: 16, lineTotal: 9000, productId: 'p-1' })
    expect(items[1]).not.toHaveProperty('productId')
  })
})
