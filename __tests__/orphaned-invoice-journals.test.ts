import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { isOrphanedPostedInvoice } from '@/lib/accounting/orphaned-invoice-journals'
import { PRISMA_POSTED_INVOICE_STATUSES } from '@/lib/finance-invoice'

describe('isOrphanedPostedInvoice', () => {
  it('flags an invoice the business treats as posted whose journal is gone', () => {
    // The state the un-posting bug left behind: status untouched, GL journal
    // reversed, posting link cleared, nobody told.
    expect(isOrphanedPostedInvoice({ status: 'approved', postingStatus: 'unposted' })).toBe(true)
  })

  it('flags it in every status that counts as posted', () => {
    for (const status of PRISMA_POSTED_INVOICE_STATUSES) {
      expect(isOrphanedPostedInvoice({ status, postingStatus: 'unposted' })).toBe(true)
    }
  })

  it('leaves a healthy posted invoice alone', () => {
    expect(isOrphanedPostedInvoice({ status: 'approved', postingStatus: 'posted' })).toBe(false)
  })

  it('leaves a draft alone — it is unposted because it was never posted', () => {
    expect(isOrphanedPostedInvoice({ status: 'draft', postingStatus: 'unposted' })).toBe(false)
  })

  it('leaves a cancelled invoice alone, whose journal is reversed on purpose', () => {
    expect(isOrphanedPostedInvoice({ status: 'cancelled', postingStatus: 'unposted' })).toBe(false)
    expect(isOrphanedPostedInvoice({ status: 'voided', postingStatus: 'unposted' })).toBe(false)
  })

  it('does not race a posting that is still in flight', () => {
    // The PUT route sets `posting` inside its transaction and flips it to
    // `posted` once the journal lands. Re-posting one of those would mint a
    // duplicate journal against a document already on its way into the ledger.
    expect(isOrphanedPostedInvoice({ status: 'approved', postingStatus: 'posting' })).toBe(false)
  })

  it('does not treat an unknown posting status as an orphan', () => {
    // Fails closed: only the exact `unposted` value earns a re-post.
    expect(isOrphanedPostedInvoice({ status: 'approved', postingStatus: 'queued' })).toBe(false)
    expect(isOrphanedPostedInvoice({ status: 'approved', postingStatus: '' })).toBe(false)
  })
})
