import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { isOrphanedPostedInvoice } from '@/lib/accounting/orphaned-invoice-journals'
import { PRISMA_POSTED_INVOICE_STATUSES } from '@/lib/finance-invoice'

const lost = {
  status: 'approved',
  postingStatus: 'unposted',
  hasReversedJournal: true,
}

describe('isOrphanedPostedInvoice', () => {
  it('flags an invoice whose journal was reversed and never replaced', () => {
    // The state the un-posting bug left behind: status untouched, journal
    // reversed, posting link cleared, nobody told.
    expect(isOrphanedPostedInvoice(lost)).toBe(true)
  })

  it('flags it in every status that counts as posted', () => {
    for (const status of PRISMA_POSTED_INVOICE_STATUSES) {
      expect(isOrphanedPostedInvoice({ ...lost, status })).toBe(true)
    }
  })

  it('leaves a healthy posted invoice alone', () => {
    expect(isOrphanedPostedInvoice({ ...lost, postingStatus: 'posted' })).toBe(false)
  })
})

describe('isOrphanedPostedInvoice — never had a journal is not the same as lost one', () => {
  it('does not flag an invoice that never reached the ledger at all', () => {
    // This is the one that matters. Without the reversal requirement the
    // predicate matched 291 invoices worth KES 9.68m — nearly all of them
    // predating the 13 Sep finance cutover, when there was no chart of accounts
    // to post into. Their absence from the GL is correct: the opening balances
    // carry them. Re-posting would have invented a year of revenue.
    expect(isOrphanedPostedInvoice({ ...lost, hasReversedJournal: false })).toBe(false)
  })

  it('is unmoved by how old or how large such an invoice is', () => {
    // No date or amount heuristic stands in for the reversal. A cutoff date
    // would have to be guessed, and would silently start including pre-cutover
    // records the moment anyone changed it.
    expect(isOrphanedPostedInvoice({
      status: 'invoiced',
      postingStatus: 'unposted',
      hasReversedJournal: false,
    })).toBe(false)
  })
})

describe('isOrphanedPostedInvoice — states that must not be touched', () => {
  it('leaves a draft alone: unposted because it was never posted', () => {
    expect(isOrphanedPostedInvoice({ ...lost, status: 'draft' })).toBe(false)
  })

  it('leaves a cancelled or voided invoice alone, whose journal is reversed on purpose', () => {
    // These DO have a reversed journal, which is exactly why status has to be
    // checked as well — the reversal alone does not distinguish a deliberate
    // cancellation from an accidental un-posting.
    expect(isOrphanedPostedInvoice({ ...lost, status: 'cancelled' })).toBe(false)
    expect(isOrphanedPostedInvoice({ ...lost, status: 'voided' })).toBe(false)
  })

  it('does not race a posting that is still in flight', () => {
    // The PUT route sets `posting` inside its transaction and flips it to
    // `posted` once the journal lands.
    expect(isOrphanedPostedInvoice({ ...lost, postingStatus: 'posting' })).toBe(false)
  })

  it('does not treat an unknown posting status as an orphan', () => {
    expect(isOrphanedPostedInvoice({ ...lost, postingStatus: 'queued' })).toBe(false)
    expect(isOrphanedPostedInvoice({ ...lost, postingStatus: '' })).toBe(false)
  })

  it('requires all three conditions, never two of them', () => {
    expect(isOrphanedPostedInvoice({ status: 'draft', postingStatus: 'unposted', hasReversedJournal: false })).toBe(false)
    expect(isOrphanedPostedInvoice({ status: 'approved', postingStatus: 'posted', hasReversedJournal: true })).toBe(false)
    expect(isOrphanedPostedInvoice({ status: 'cancelled', postingStatus: 'unposted', hasReversedJournal: true })).toBe(false)
  })
})
