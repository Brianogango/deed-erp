import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supplier credit notes are used on a supplier's unpaid bill (no money moves,
// no journal) or refunded by the supplier (money in: Dr bank / Cr payables).
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  rows: {} as Record<string, any>,
  paymentCreate: vi.fn(),
  allocationCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  journal: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAuditInTx: vi.fn() }))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/accounting/journal-service', () => ({ createJournalEntryInTx: m.journal }))
vi.mock('@/lib/accounting/bank-cash-account.server', () => ({ BankAccountRefError: class extends Error {}, cashLabelForBankAccount: vi.fn(async () => 'BANK') }))
vi.mock('@/lib/documents-broadcast.server', () => ({ refreshInvoicesBlob: vi.fn() }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    invoice: {
      findUnique: vi.fn(async ({ where }: any) => m.rows[where.id] ?? null),
      update: vi.fn(async ({ where, data }: any) => { m.invoiceUpdate({ where, data }); m.rows[where.id] = { ...m.rows[where.id], ...data }; return m.rows[where.id] }),
    },
    payment: { create: vi.fn(async (a: any) => { m.paymentCreate(a); return { id: 'pay-1', ...a.data } }), update: vi.fn() },
    paymentAllocation: { create: m.allocationCreate },
  }
  return { default: { ...tx, $transaction: async (fn: any) => fn(tx) } }
})

import { POST } from '@/app/api/invoices/[id]/supplier-credit/route'

const session = (role: string) => ({ user: { id: '22222222-2222-4222-8222-222222222222', name: 'F', username: 'f', role, modules: ['accounting'] } })
const call = (id: string, body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) } as any)

beforeEach(() => {
  vi.clearAllMocks()
  m.getServerSession.mockResolvedValue(session('finance_officer'))
  m.journal.mockResolvedValue({ id: 'je-1' })
  m.rows = {
    vcn: { id: 'vcn', invoiceNumber: 'VCN/2026/0009', documentType: 'vendor_bill', status: 'approved', totalAmount: -23000, amountPaid: 0, clientId: 'sup-1', currencyCode: 'KES', postedJournalEntryId: 'je-vcn', notes: 'Purchase return RET/1' },
    bill: { id: 'bill', invoiceNumber: 'BILL/2026/0300', documentType: 'vendor_bill', status: 'approved', totalAmount: 50000, amountPaid: 10000, clientId: 'sup-1', currencyCode: 'KES', paymentBlocked: false },
    otherSupplierBill: { id: 'otherSupplierBill', invoiceNumber: 'BILL/2026/0301', documentType: 'vendor_bill', status: 'approved', totalAmount: 50000, amountPaid: 0, clientId: 'sup-2', currencyCode: 'KES' },
  }
})

describe('use a supplier credit on a bill', () => {
  it('lowers the bill and uses up the credit, with no cash and no new journal', async () => {
    const res = await call('vcn', { action: 'apply', billId: 'bill', amount: 23000 })
    expect(res.status).toBe(200)
    expect(m.rows.bill.amountPaid).toBe(33000)
    expect(m.rows.vcn.amountPaid).toBe(-23000)
    const pay = m.paymentCreate.mock.calls[0][0].data
    expect(pay).toMatchObject({ invoiceId: 'bill', paymentMethod: 'credit', paymentType: 'vendor_credit', reference: 'VCN/2026/0009', journalId: 'je-vcn' })
    expect(pay.notes).toContain('method:vendor_credit')
    expect(m.allocationCreate).toHaveBeenCalled()
    expect(m.journal).not.toHaveBeenCalled()
  })

  it('never more than the credit left or the bill owes', async () => {
    m.rows.bill.amountPaid = 45000
    await call('vcn', { action: 'apply', billId: 'bill', amount: 23000 })
    expect(m.rows.bill.amountPaid).toBe(50000)
    expect(m.rows.vcn.amountPaid).toBe(-5000)
  })

  it('refuses another supplier\'s bill, a used-up credit, and staff outside finance', async () => {
    expect((await call('vcn', { action: 'apply', billId: 'otherSupplierBill' })).status).toBe(409)
    m.rows.vcn.amountPaid = -23000
    expect((await call('vcn', { action: 'apply', billId: 'bill' })).status).toBe(409)
    m.rows.vcn.amountPaid = 0
    m.getServerSession.mockResolvedValue(session('inventory_officer'))
    expect((await call('vcn', { action: 'apply', billId: 'bill' })).status).toBe(403)
    expect(m.paymentCreate).not.toHaveBeenCalled()
  })

  it('a normal bill is not a credit note', async () => {
    expect((await call('bill', { action: 'apply', billId: 'bill' })).status).toBe(400)
  })
})

describe('supplier refunds a credit', () => {
  it('books money in: Dr bank, Cr payables, and uses up the credit', async () => {
    const res = await call('vcn', { action: 'refund', amount: 23000, paymentMethod: 'bank_transfer', reference: 'FT123' })
    expect(res.status).toBe(200)
    const lines = m.journal.mock.calls[0][1].lines
    expect(lines[0]).toMatchObject({ debit: 23000, credit: 0 })
    expect(lines[1]).toMatchObject({ debit: 0, credit: 23000 })
    expect(m.rows.vcn.amountPaid).toBe(-23000)
    expect(m.paymentCreate.mock.calls[0][0].data.notes).toContain('method:vendor_refund')
  })

  it('cannot refund more than is open', async () => {
    m.rows.vcn.amountPaid = -20000
    await call('vcn', { action: 'refund', amount: 23000, paymentMethod: 'cash' })
    expect(m.journal.mock.calls[0][1].lines[0].debit).toBe(3000)
  })
})
