import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelCreditAmount } from '@/lib/finance/cancel-credit'

// Cancelling a paid invoice that already had a credit note credited the
// customer for the full payment again: the credited part was given twice.

describe('cancelCreditAmount', () => {
  it('credits the full payment when nothing was credited before', () => {
    expect(cancelCreditAmount({ amountPaid: 10000, total: 10000, alreadyCredited: 0 })).toBe(10000)
  })
  it('credits only what is left after a credit note', () => {
    expect(cancelCreditAmount({ amountPaid: 10000, total: 10000, alreadyCredited: 3000 })).toBe(7000)
  })
  it('credits nothing when the invoice was fully credited already', () => {
    expect(cancelCreditAmount({ amountPaid: 10000, total: 10000, alreadyCredited: 10000 })).toBe(0)
  })
  it('a credit note applied to the unpaid part is not cash: paid 6,000 + note 3,000 on the balance → 6,000 back', () => {
    // The invoice counts the applied note as paid (9,000); the note is 3,000.
    expect(cancelCreditAmount({ amountPaid: 9000, total: 10000, alreadyCredited: 3000 })).toBe(6000)
  })
  it('never more than the invoice total, never negative', () => {
    expect(cancelCreditAmount({ amountPaid: 12000, total: 10000, alreadyCredited: 0 })).toBe(10000)
    expect(cancelCreditAmount({ amountPaid: 1000, total: 10000, alreadyCredited: 4000 })).toBe(0)
  })
})

const notes: any[] = []
let credits: any[] = []
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: { creditNote: { findMany: async () => notes } } }))
vi.mock('@/lib/server-store', () => ({ loadAppState: async () => ({ deed_customerCredits: credits }) }))

describe('alreadyCreditedOnInvoice', () => {
  beforeEach(() => { notes.length = 0; credits = [] })

  it('counts a credit note once, though it also appears as a customer credit', async () => {
    const { alreadyCreditedOnInvoice } = await import('@/lib/finance/cancel-credit.server')
    notes.push({ creditNoteNumber: 'CN/2026/0010', amount: 3000 })
    credits = [{ ref: 'CN/2026/0010', sourceInvoiceId: 'inv1', amount: 3000, status: 'available' }]
    expect(await alreadyCreditedOnInvoice('inv1')).toBe(3000)
  })

  it('adds a credit issued from the sale order, which has no credit-note record', async () => {
    const { alreadyCreditedOnInvoice } = await import('@/lib/finance/cancel-credit.server')
    notes.push({ creditNoteNumber: 'CN/2026/0010', amount: 3000 })
    credits = [{ ref: 'CN/2026/0011', sourceInvoiceId: 'inv1', amount: 1500, status: 'available' }]
    expect(await alreadyCreditedOnInvoice('inv1')).toBe(4500)
  })

  it('leaves out the cancel’s own credit and other invoices’ credits', async () => {
    const { alreadyCreditedOnInvoice } = await import('@/lib/finance/cancel-credit.server')
    credits = [
      { ref: 'CN/2026/0012', sourceInvoiceId: 'inv1', amount: 7000, status: 'available' },
      { ref: 'CN/2026/0009', sourceInvoiceId: 'inv2', amount: 999, status: 'available' },
    ]
    expect(await alreadyCreditedOnInvoice('inv1', 'CN/2026/0012')).toBe(0)
  })
})

describe('cancelling a partly paid invoice reverses the whole sale', () => {
  it('10,000 incl. VAT, 6,000 paid: 6,000 to credit, 4,000 off receivables, sales and VAT reversed on all 10,000', async () => {
    const { cancelReversal, openReceivable } = await import('@/lib/finance/cancel-credit')
    const receivable = openReceivable({ total: 11600, amountPaid: 6000 })
    expect(receivable).toBe(5600)
    const r = cancelReversal({ total: 11600, subtotal: 10000, tax: 1600, credit: 6000, receivable })
    expect(r).toMatchObject({ credit: 6000, receivable: 5600, revenue: 10000, vat: 1600, total: 11600 })
  })

  it('always balances, VAT or not', async () => {
    const { cancelReversal } = await import('@/lib/finance/cancel-credit')
    for (const [total, subtotal, tax, credit, receivable] of [[1000, 862.07, 137.93, 333.33, 0], [5000, 5000, 0, 1200, 3800], [999.99, 862.06, 137.93, 0, 999.99]]) {
      const r = cancelReversal({ total, subtotal, tax, credit, receivable })
      expect(Math.round((r.revenue + r.vat) * 100)).toBe(Math.round((r.credit + r.receivable) * 100))
    }
  })

  it('a fully paid invoice has nothing left in receivables', async () => {
    const { openReceivable } = await import('@/lib/finance/cancel-credit')
    expect(openReceivable({ total: 10000, amountPaid: 10000 })).toBe(0)
    expect(openReceivable({ total: 10000, amountPaid: 12000 })).toBe(0)
  })
})
