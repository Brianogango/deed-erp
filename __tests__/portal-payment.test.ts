import { describe, it, expect } from 'vitest'
import {
  isAwaitingQuoteRevision,
  resolvePortalPaymentStatus,
  residualAmountDue,
  settlementAfterReapproval,
} from '@/lib/portal-payment'

describe('isAwaitingQuoteRevision', () => {
  it('is true only when awaiting_approval with a change summary', () => {
    expect(isAwaitingQuoteRevision({ status: 'awaiting_approval', changeSummary: 'Removed: X' })).toBe(true)
    expect(isAwaitingQuoteRevision({ status: 'awaiting_approval', changeSummary: '   ' })).toBe(false)
    expect(isAwaitingQuoteRevision({ status: 'approved', changeSummary: 'Removed: X' })).toBe(false)
    expect(isAwaitingQuoteRevision({ status: 'awaiting_approval' })).toBe(false)
  })
})

describe('resolvePortalPaymentStatus', () => {
  it('does not surface paid/auto_paid while a revised quote awaits re-approval (REP-200002 case)', () => {
    expect(resolvePortalPaymentStatus({
      status: 'awaiting_approval',
      changeSummary: 'Total: KES 38,000 → KES 17,200',
      paymentConfirmationStatus: 'confirmed',
      invoiceAmountPaid: 38000,
      invoiceTotal: 17200,
    })).toBe('unpaid')

    expect(resolvePortalPaymentStatus({
      status: 'awaiting_approval',
      changeSummary: 'Changed line',
      paymentConfirmationStatus: 'auto_paid',
      invoiceAmountPaid: 38000,
      invoiceTotal: 17200,
    })).toBe('unpaid')
  })

  it('still maps confirmed/auto_paid when not awaiting revision', () => {
    expect(resolvePortalPaymentStatus({
      status: 'ready',
      paymentConfirmationStatus: 'confirmed',
      invoiceAmountPaid: 38000,
      invoiceTotal: 38000,
    })).toBe('paid')

    expect(resolvePortalPaymentStatus({
      status: 'ready',
      paymentConfirmationStatus: 'auto_paid',
    })).toBe('auto_paid')
  })

  it('preserves pending_review / rejected during revision', () => {
    expect(resolvePortalPaymentStatus({
      status: 'awaiting_approval',
      changeSummary: 'diff',
      paymentConfirmationStatus: 'pending_review',
    })).toBe('pending_review')
    expect(resolvePortalPaymentStatus({
      status: 'awaiting_approval',
      changeSummary: 'diff',
      paymentConfirmationStatus: 'rejected',
    })).toBe('rejected')
  })

  it('falls back to invoice paid >= total when no confirmation status', () => {
    expect(resolvePortalPaymentStatus({
      status: 'ready',
      invoiceAmountPaid: 1000,
      invoiceTotal: 1000,
    })).toBe('paid')
    expect(resolvePortalPaymentStatus({
      status: 'ready',
      invoiceAmountPaid: 100,
      invoiceTotal: 1000,
    })).toBe('unpaid')
  })
})

describe('residualAmountDue', () => {
  it('computes residual and floors at zero (overpayment → credit)', () => {
    expect(residualAmountDue(17200, 38000)).toBe(0)
    expect(residualAmountDue(38000, 17200)).toBe(20800)
    expect(residualAmountDue(17200, 0)).toBe(17200)
  })
})

describe('settlementAfterReapproval', () => {
  it('marks fully covered when prior payment exceeds revised total', () => {
    const s = settlementAfterReapproval({
      approvedTotal: 17200,
      amountPaid: 38000,
      priorConfirmationStatus: 'confirmed',
    })
    expect(s.fullyCovered).toBe(true)
    expect(s.residualDue).toBe(0)
    expect(s.creditBalance).toBe(20800)
    expect(s.nextConfirmationStatus).toBe('confirmed')
  })

  it('asks for residual when prior payment is less than revised total', () => {
    const s = settlementAfterReapproval({
      approvedTotal: 50000,
      amountPaid: 38000,
      priorConfirmationStatus: 'confirmed',
    })
    expect(s.fullyCovered).toBe(false)
    expect(s.residualDue).toBe(12000)
    expect(s.nextConfirmationStatus).toBe('unpaid')
  })

  it('keeps auto_paid when prior auto payment still covers', () => {
    const s = settlementAfterReapproval({
      approvedTotal: 10000,
      amountPaid: 10000,
      priorConfirmationStatus: 'auto_paid',
    })
    expect(s.nextConfirmationStatus).toBe('auto_paid')
  })
})
