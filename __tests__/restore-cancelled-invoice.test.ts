import { describe, it, expect } from 'vitest'
import {
  restoreCancelledInvoiceDecision, creditIsSpent, restoreSummary,
  restoreFromCancelledGuard,
} from '@/lib/finance/restore-cancelled-invoice'

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'i1', ref: 'INV/2026/0310', type: 'customer_invoice', status: 'cancelled',
  amountPaid: 0, total: 52000, ...over,
})
const credit = (over: Record<string, unknown> = {}) => ({
  id: 'cn1', ref: 'CN/2026/0004', sourceInvoiceId: 'i1',
  amount: 52000, balance: 52000, status: 'available', applications: [], ...over,
})

describe('restoring a cancelled document', () => {
  it('brings it back as a draft, never straight to posted', () => {
    const decision = restoreCancelledInvoiceDecision({ invoice: invoice(), allowed: true })
    expect(decision).toEqual({ ok: true, nextStatus: 'draft', creditToVoid: null })
  })

  it('works the same for a vendor bill', () => {
    const decision = restoreCancelledInvoiceDecision({ invoice: invoice({ type: 'vendor_bill', ref: 'BILL/0042' }), allowed: true })
    expect(decision.ok).toBe(true)
  })

  it('refuses anything that is not cancelled', () => {
    for (const status of ['draft', 'posted', 'voided']) {
      const decision = restoreCancelledInvoiceDecision({ invoice: invoice({ status }), allowed: true })
      expect(decision).toMatchObject({ ok: false })
      expect((decision as { error: string }).error).toContain('not cancelled')
    }
  })

  it('refuses someone without the right to cancel one in the first place', () => {
    const decision = restoreCancelledInvoiceDecision({ invoice: invoice(), allowed: false })
    expect(decision).toMatchObject({ ok: false })
    expect((decision as { error: string }).error).toContain('Finance, Admin Officer, or Director')
  })

  it('takes an unused credit note back with it', () => {
    const decision = restoreCancelledInvoiceDecision({ invoice: invoice(), credits: [credit()], allowed: true })
    expect(decision).toMatchObject({ ok: true, creditToVoid: { ref: 'CN/2026/0004' } })
  })

  it('refuses when the credit note has been spent, so the money is not counted twice', () => {
    const spent = [
      credit({ applications: [{ invoiceId: 'i9', amount: 10000 }] }),
      credit({ balance: 42000 }),
      credit({ status: 'used', balance: 0 }),
      credit({ status: 'partially_used', balance: 30000 }),
    ]
    for (const c of spent) {
      const decision = restoreCancelledInvoiceDecision({ invoice: invoice(), credits: [c], allowed: true })
      expect(decision).toMatchObject({ ok: false })
      expect((decision as { error: string }).error).toContain('CN/2026/0004')
    }
  })

  it('ignores a credit that belongs to another invoice, or one already void', () => {
    const others = [credit({ sourceInvoiceId: 'i2', applications: [{}] }), credit({ status: 'void', balance: 0 })]
    const decision = restoreCancelledInvoiceDecision({ invoice: invoice(), credits: others, allowed: true })
    expect(decision).toEqual({ ok: true, nextStatus: 'draft', creditToVoid: null })
  })

  it('refuses a paid document that has no credit note, because a draft cannot hold the money', () => {
    const decision = restoreCancelledInvoiceDecision({ invoice: invoice({ amountPaid: 52000 }), allowed: true })
    expect(decision).toMatchObject({ ok: false })
    expect((decision as { error: string }).error).toContain('Refund or re-allocate')
  })

  it('reads a spent credit by any of the three signs', () => {
    expect(creditIsSpent(credit())).toBe(false)
    expect(creditIsSpent(credit({ applications: [{}] }))).toBe(true)
    expect(creditIsSpent(credit({ status: 'used' }))).toBe(true)
    expect(creditIsSpent(credit({ balance: 1 }))).toBe(true)
  })

  it('says what happened, including the credit it voided', () => {
    expect(restoreSummary(invoice(), null)).toBe('Invoice INV/2026/0310 is a draft again. Check it, then confirm to post it.')
    expect(restoreSummary(invoice({ type: 'vendor_bill', ref: 'BILL/0042' }), credit()))
      .toContain('credit note CN/2026/0004 was voided with it')
  })
})

describe('the server gate for leaving cancelled', () => {
  const guard = (over: Record<string, unknown> = {}) => restoreFromCancelledGuard({
    beforeStatus: 'cancelled', nextStatus: 'draft', restoreRequested: true, allowed: true, ...over,
  } as never)

  it('lets a deliberate restore through', () => {
    expect(guard()).toEqual({ ok: true })
  })

  it('refuses an ordinary edit that happens to carry draft — a stale tab', () => {
    expect(guard({ restoreRequested: false })).toMatchObject({ ok: false, status: 409 })
    expect(guard({ restoreRequested: undefined })).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses someone without the right', () => {
    expect(guard({ allowed: false })).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses a jump straight back to posted', () => {
    expect(guard({ nextStatus: 'posted' })).toMatchObject({ ok: false, status: 409 })
  })

  it('stays out of the way of every other edit', () => {
    expect(guard({ beforeStatus: 'posted', nextStatus: 'draft', restoreRequested: false })).toEqual({ ok: true })
    expect(guard({ beforeStatus: 'draft', nextStatus: 'posted', restoreRequested: false })).toEqual({ ok: true })
    expect(guard({ nextStatus: undefined, restoreRequested: false })).toEqual({ ok: true })
    expect(guard({ nextStatus: 'cancelled', restoreRequested: false })).toEqual({ ok: true })
  })
})
