import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/invoices: request markers ("repair" in notes, isPosInvoice) let
// technicians / till staff in, but only to create a customer invoice — never a
// vendor bill or a document pre-marked as paid. Real lib/auth/api runs.
const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  invoiceCreate: vi.fn(),
  findRepairInPrisma: vi.fn(),
  createJournalEntry: vi.fn(),
  buildInvoiceJournalInput: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: m.getServerSession }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: { create: m.invoiceCreate, update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    payment: { create: vi.fn() },
    client: { findUnique: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }) },
  },
}))
vi.mock('@/lib/repair-mirror', () => ({ findRepairInPrisma: m.findRepairInPrisma }))
vi.mock('@/lib/legacy-compat', async orig => ({
  ...(await orig() as object),
  resolveClientId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
}))
vi.mock('@/lib/sales/serial-invoice-gate.server', () => ({ serialInvoiceGateError: vi.fn(async () => null) }))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: vi.fn(async () => 'INV/2026/0001') }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn(), writeFinancialAuditInTx: vi.fn() }))
vi.mock('@/lib/accounting/invoice-journals', () => ({
  buildInvoiceJournalInput: m.buildInvoiceJournalInput,
  allocateInvoiceJournalRef: vi.fn(async (r: string) => r),
}))
vi.mock('@/lib/accounting/journal-service', () => ({ createJournalEntry: m.createJournalEntry }))
vi.mock('@/lib/accounting/invoice-tax.server', () => ({ recordInvoiceTax: vi.fn(async () => {}) }))
vi.mock('@/lib/documents-broadcast.server', () => ({ addInvoicesToList: vi.fn(async () => {}) }))
vi.mock('@/lib/accounting/sales-commission', () => ({ postSalesCommissionForInvoice: vi.fn() }))
vi.mock('@/lib/http-metrics', () => ({ recordHttpMetric: vi.fn() }))

import { POST } from '@/app/api/invoices/route'

const session = (role: string) => ({ user: { id: '22222222-2222-4222-8222-222222222222', name: 'U', username: 'u', role, modules: ['repair', 'sales', 'accounting'] } })
const base = {
  clientId: '11111111-1111-4111-8111-111111111111', invoiceDate: '2026-10-01', dueDate: '2026-10-31',
  lines: [{ description: 'Item', qty: 1, unitPrice: 50000, taxRate: 0, taxCategory: 'exempt' }],
}
const req = (body: unknown) => new Request('http://localhost/api/invoices', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

describe('POST /api/invoices role lanes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.invoiceCreate.mockImplementation(async ({ data }: any) => ({ id: 'inv-1', ...data, items: data.items.create }))
    m.buildInvoiceJournalInput.mockResolvedValue({ ref: 'JRN/X', lines: [] })
    m.createJournalEntry.mockResolvedValue({ id: 'je-1' })
    m.findRepairInPrisma.mockResolvedValue(null)
  })

  it('technician cannot create a vendor bill by writing "repair" in the notes', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    const res = await POST(req({ ...base, type: 'vendor_bill', status: 'posted', notes: 'repair parts' }))
    expect(res.status).toBe(403)
    expect(m.invoiceCreate).not.toHaveBeenCalled()
  })

  it('technician needs a repair that actually exists', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    const res = await POST(req({ ...base, notes: 'repair' }))
    expect(res.status).toBe(403)
    expect(m.invoiceCreate).not.toHaveBeenCalled()
  })

  it('technician invoice for an existing repair is created, never pre-marked paid', async () => {
    m.getServerSession.mockResolvedValue(session('technician'))
    m.findRepairInPrisma.mockResolvedValue({ id: 'rep-1', ref: 'REP/0001' })
    const res = await POST(req({ ...base, repairRef: 'REP/0001', status: 'paid', amountPaid: 50000 }))
    expect(res.status).toBe(201)
    expect(m.findRepairInPrisma).toHaveBeenCalledWith('REP/0001')
    expect(m.invoiceCreate.mock.calls[0][0].data.amountPaid).toBe(0)
  })

  it('till staff cannot create a vendor bill through the POS flag', async () => {
    m.getServerSession.mockResolvedValue(session('sales_rep'))
    const res = await POST(req({ ...base, type: 'vendor_bill', isPosInvoice: true }))
    expect(res.status).toBe(403)
    expect(m.invoiceCreate).not.toHaveBeenCalled()
  })

  it('finance can still create vendor bills', async () => {
    m.getServerSession.mockResolvedValue(session('finance_officer'))
    const res = await POST(req({ ...base, type: 'vendor_bill' }))
    expect(res.status).toBe(201)
    expect(m.invoiceCreate.mock.calls[0][0].data.documentType).toBe('vendor_bill')
  })
})
