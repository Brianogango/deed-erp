import { describe, expect, it } from 'vitest'
import { repairInvoiceJourneyAction, repairInvoiceJourneyLabel } from '@/lib/repair-journey'

describe('repair invoice journey', () => {
  it('creates an invoice only when none exists and billing is actually due', () => {
    const action = repairInvoiceJourneyAction({
      repairStatus: 'ready',
      billingSyncNeeded: true,
      canManageBilling: true,
    })
    expect(action).toBe('create')
    expect(repairInvoiceJourneyLabel(action)).toBe('Create Invoice')
  })

  it('never keeps Create Invoice once an invoice exists', () => {
    expect(repairInvoiceJourneyAction({
      repairStatus: 'invoiced',
      invoice: { status: 'posted', amountPaid: 0 },
      billingSyncNeeded: false,
      canManageBilling: true,
    })).toBe('view')
  })

  it('uses Confirm Invoice for an existing draft invoice', () => {
    const action = repairInvoiceJourneyAction({
      repairStatus: 'ready',
      invoice: { status: 'draft', amountPaid: 0 },
      billingSyncNeeded: false,
      canManageBilling: true,
    })
    expect(action).toBe('confirm')
    expect(repairInvoiceJourneyLabel(action)).toBe('Confirm Invoice')
  })

  it('uses Align rather than Create when an existing unpaid invoice is out of sync', () => {
    const action = repairInvoiceJourneyAction({
      repairStatus: 'invoiced',
      invoice: { status: 'posted', amountPaid: 0 },
      billingSyncNeeded: true,
      canRewriteInvoice: true,
      canManageBilling: true,
    })
    expect(action).toBe('align')
    expect(repairInvoiceJourneyLabel(action)).toBe('Align Invoice with Quote')
  })

  it('does not offer invoice mutation after payment has started', () => {
    expect(repairInvoiceJourneyAction({
      repairStatus: 'invoiced',
      invoice: { status: 'posted', amountPaid: 500 },
      billingSyncNeeded: true,
      canRewriteInvoice: true,
      canManageBilling: true,
    })).toBe('view')
  })

  it('keeps terminal repairs read-only while preserving View Invoice', () => {
    expect(repairInvoiceJourneyAction({
      repairStatus: 'closed',
      invoice: { status: 'posted' },
      billingSyncNeeded: false,
      canManageBilling: true,
    })).toBe('view')
    expect(repairInvoiceJourneyAction({
      repairStatus: 'closed',
      billingSyncNeeded: true,
      canManageBilling: true,
    })).toBe('none')
  })

  it('skips customer billing for no-charge repairs', () => {
    expect(repairInvoiceJourneyAction({
      repairStatus: 'ready',
      noCharge: true,
      billingSyncNeeded: true,
      canManageBilling: true,
    })).toBe('none')
  })
})
