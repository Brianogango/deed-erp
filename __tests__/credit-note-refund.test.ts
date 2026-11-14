import { beforeEach, describe, expect, it, vi } from 'vitest'

// Part refund on a paid invoice: credit note for the work not done → the
// customer's credit → refunded as money.

const h = vi.hoisted(() => ({
  credits: [] as any[],
  saved: vi.fn(),
  journal: vi.fn(),
  createNote: vi.fn(),
  addBalance: vi.fn(),
  invoice: null as any,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
  loadAppStateForWrite: async () => ({ deed_customerCredits: h.credits }),
  saveStoreKeys: h.saved,
  notifyStoreKeysChanged: vi.fn(async () => {}),
}))
vi.mock('@/lib/accounting/journal-service', () => ({ createJournalEntry: h.journal }))
vi.mock('@/lib/accounting/bank-cash-account.server', () => ({
  cashLabelForBankAccount: vi.fn(async () => '2202 - Equity Bank'),
  BankAccountRefError: class extends Error { status = 400 },
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({ default: { invoice: { findUnique: vi.fn(async () => h.invoice) } } }))
vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (fn: () => Promise<Response>) => {
    try { return await fn() } catch (err: any) { return new Response(JSON.stringify({ error: err.message }), { status: err.status ?? 500 }) }
  },
  requirePermission: vi.fn(async () => ({ id: 'u1', name: 'Fin', role: 'finance_officer' })),
}))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn(async () => 'CN/2026/0007') }))

vi.mock('@/lib/accounting/credit-note-service', async importOriginal => ({ ...(await importOriginal<object>()), createCustomerCreditNote: h.createNote }))
vi.mock('@/lib/accounting/customer-credit-balance.server', async importOriginal => ({ ...(await importOriginal<object>()), addCustomerCreditBalance: h.addBalance }))

import { creditLinesForAmount } from '@/lib/accounting/credit-note-service'
import { POST as creditNote } from '@/app/api/invoices/[id]/credit-note/route'
const { refundCustomerCredit } = await vi.importActual<typeof import('@/lib/accounting/customer-credit-balance.server')>('@/lib/accounting/customer-credit-balance.server')

beforeEach(() => {
  vi.clearAllMocks()
  h.journal.mockResolvedValue({ id: 'j1' })
  h.credits = [{ id: 'c1', ref: 'CN/2026/0007', customerName: 'Amani', amount: 3000, balance: 3000, status: 'available', applications: [] }]
})

describe('creditLinesForAmount', () => {
  it('spreads an amount over the lines in order, as part-quantities', () => {
    expect(creditLinesForAmount([{ id: 'a', qty: 1, lineTotal: 2000 }, { id: 'b', qty: 2, lineTotal: 4000 }], 3000))
      .toEqual([{ invoiceItemId: 'a', qty: 1, returnToStock: false }, { invoiceItemId: 'b', qty: 0.5, returnToStock: false }])
  })
  it('null when the lines cannot carry it', () => {
    expect(creditLinesForAmount([{ id: 'a', qty: 1, lineTotal: 2000 }], 2500)).toBeNull()
  })
})

describe('refundCustomerCredit', () => {
  it('pays the credit back: Dr 3313 / Cr the till, and lowers the balance', async () => {
    const out = await refundCustomerCredit({ creditId: 'c1', amount: 1000, method: 'mpesa', reference: 'QAB12', date: new Date('2026-11-14'), actor: { id: 'u1', name: 'Fin' } })
    expect(out).toEqual({ ref: 'CN/2026/0007', refunded: 1000, balance: 2000 })
    const entry = h.journal.mock.calls[0][0]
    expect(entry.lines[0]).toMatchObject({ accountLabel: '3313 - Customer Credits', debit: 1000 })
    expect(entry.lines[1]).toMatchObject({ accountLabel: '2211 - Petty Cash / Mobile Money', credit: 1000 })
    expect(h.credits[0]).toMatchObject({ balance: 2000, status: 'partially_used' })
    expect(h.credits[0].refunds).toHaveLength(1)
    expect(h.saved).toHaveBeenCalled()
  })

  it('uses the chosen bank account and closes the credit when all of it is refunded', async () => {
    await refundCustomerCredit({ creditId: 'c1', amount: 3000, method: 'bank_transfer', bankAccountId: 'bank-1', date: new Date(), actor: { id: 'u1', name: 'Fin' } })
    expect(h.journal.mock.calls[0][0].lines[1].accountLabel).toBe('2202 - Equity Bank')
    expect(h.credits[0]).toMatchObject({ balance: 0, status: 'used' })
  })

  it('never more than what is left, and nothing is booked', async () => {
    await expect(refundCustomerCredit({ creditId: 'c1', amount: 3500, method: 'cash', date: new Date(), actor: { id: 'u1', name: 'Fin' } })).rejects.toThrow(/Only 3,000/)
    expect(h.journal).not.toHaveBeenCalled()
  })
})

describe('POST /api/invoices/[id]/credit-note', () => {
  const call = (body: unknown) => creditNote(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'inv-1' }) })

  beforeEach(() => {
    h.invoice = {
      id: 'inv-1', invoiceNumber: 'INV/2026/0100', clientId: 'cl-1', client: { name: 'Amani' }, isDownPayment: false, status: 'paid',
      items: [{ id: 'it-1', qty: 1, lineTotal: 5800 }, { id: 'it-2', qty: 1, lineTotal: 2320 }],
    }
    h.createNote.mockResolvedValue({ ref: 'CN/2026/0007', amount: 2320, appliedToAr: 0, customerCredit: 2320 })
  })

  it('credits the line not done by amount; what was paid becomes the customer’s credit', async () => {
    const res = await call({ reason: 'Keyboard not replaced', lines: [{ invoiceItemId: 'it-2', amount: 1160 }] })
    expect(res.status).toBe(200)
    expect(h.createNote.mock.calls[0][0]).toMatchObject({ invoiceId: 'inv-1', creditNoteNumber: 'CN/2026/0007', lines: [{ invoiceItemId: 'it-2', qty: 0.5 }] })
    expect(h.addBalance).toHaveBeenCalledWith(expect.objectContaining({ ref: 'CN/2026/0007', customerId: 'cl-1', amount: 2320, sourceInvoiceRef: 'INV/2026/0100' }))
  })

  it('needs a reason', async () => {
    expect((await call({ lines: [{ invoiceItemId: 'it-2', amount: 100 }] })).status).toBe(400)
    expect(h.createNote).not.toHaveBeenCalled()
  })
})
