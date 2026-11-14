import { beforeEach, describe, expect, it, vi } from 'vitest'

// Tax the customer withheld (certificate) settles the invoice without cash.
// Setup copied from api-invoice-payment-posted-gate.test.ts.
//
// a posted invoice hydrated from Prisma carries status 'approved'/'invoiced'
// (see INVOICE_STATUS_MAP in the invoice route), which the UI badge and the
// "Register payment" button already treat as Posted. The payment guard must
// agree, otherwise the button appears but the payment is rejected.
//
// `invoiceDocState` is intentionally NOT mocked so the test exercises the real
// document-state projection the fix relies on.

const {
  mockRequireRole,
  mockCheckFiscalLock,
  mockFindUnique,
  mockFindFirst,
  mockUpdateInvoice,
  mockRecordPayment,
  mockLoadAppState,
  mockResolveMirror,
  mockPostJournal,
  mockNotify,
  mockGate,
  mockSod,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockCheckFiscalLock: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdateInvoice: vi.fn(),
  mockRecordPayment: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockResolveMirror: vi.fn(),
  mockPostJournal: vi.fn(),
  mockNotify: vi.fn(),
  mockGate: vi.fn(),
  mockSod: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status })
    }
  },
  requireRole: mockRequireRole,
  requirePermission: mockRequireRole,
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: { findUnique: mockFindUnique, update: mockUpdateInvoice },
    payment: { findFirst: mockFindFirst },
    accountCode: { findMany: vi.fn(async () => [{ code: '6519' }]) },
  },
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn(), writeFinancialAuditInTx: vi.fn() }))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState }))
vi.mock('@/lib/finance-controls', () => ({
  canPostOrPayCustomerInvoice: mockGate,
  canPayOwnPostedInvoice: mockSod,
  DEFAULT_ADMIN_OFFICER_CUSTOMER_INVOICE_LIMIT_KES: 100_000,
}))
vi.mock('@/lib/fiscal-lock.server', () => ({ checkFiscalLock: mockCheckFiscalLock }))
vi.mock('@/lib/accounting/resolve-invoice-mirror', () => ({ resolveBlobInvoiceMirror: mockResolveMirror }))
vi.mock('@/lib/accounting/payment-allocations', () => ({ recordPaymentWithAllocations: mockRecordPayment }))
vi.mock('@/lib/accounting/invoice-journals', () => ({ postInvoicePaymentJournalToPrisma: mockPostJournal }))
vi.mock('@/lib/accounting/ensure-template-accounts', () => ({ ensureTemplateAccounts: vi.fn(async () => {}) }))
vi.mock('@/lib/notifications/business-events', () => ({ notifyInvoicePayment: vi.fn(async () => {}) }))
vi.mock('@/lib/finance/payment-receipt-notify', () => ({ notifyCustomerPaymentReceived: mockNotify }))

import { POST } from '@/app/api/invoices/[id]/payments/route'
import { suggestedWithholding, WITHHELD_INCOME_TAX, WITHHELD_VAT } from '@/lib/accounting/withholding'

function payReq(body: unknown): Request {
  return new Request('http://localhost/api/invoices/inv-1/payments', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const invoiceWithStatus = (status: string) => ({
  id: 'inv-1',
  status,
  totalAmount: 1000,
  amountPaid: 0,
  paymentBlocked: false,
  invoiceNumber: 'INV/2026/0126',
})

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'finance_officer', name: 'Fin' })
  mockCheckFiscalLock.mockResolvedValue({ ok: true })
  mockLoadAppState.mockResolvedValue({ deed_invoices: [], deed_systemSettings: {} })
  mockGate.mockReturnValue({ ok: true })
  mockSod.mockReturnValue({ ok: true })
  mockResolveMirror.mockResolvedValue({ type: 'customer_invoice', partnerName: 'Amani' })
  mockRecordPayment.mockResolvedValue({ payment: { id: 'pay-1', paidAt: new Date() }, allocations: [{ id: 'alloc-1' }] })
  mockFindUnique.mockResolvedValue({ ...invoiceWithStatus('approved'), totalAmount: 58000, amountPaid: 57000 })
})

const params = { params: Promise.resolve({ id: 'inv-1' }) }

describe('withholding on a customer receipt', () => {
  it('books withholding VAT against 1151, not a bank, and files it for the VAT return', async () => {
    const res = await POST(payReq({ amount: 1000, paymentMethod: WITHHELD_VAT, reference: 'KRA-123', bankAccountId: 'bank-1' }), params)
    expect(res.status).toBe(200)
    const opts = mockRecordPayment.mock.calls[0][0]
    expect(opts.bankAccountId).toBeNull()
    const journal = opts.journal('pay-1')
    expect(journal.journalCode).toBe('MISC')
    expect(journal.lines[0]).toMatchObject({ accountLabel: '1151 - VAT Withheld by Customers', debit: 1000 })
    expect(journal.lines[1]).toMatchObject({ accountLabel: '1800 - Accounts Receivable', credit: 1000 })
    const create = vi.fn()
    await opts.audit({ taxTransaction: { create } }, { id: 'pay-1' }, [])
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ sourceType: 'payment_withholding', withholdingVat: 1000, taxAmount: 0 }) })
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('books withholding income tax against 1152 and leaves the VAT return alone', async () => {
    await POST(payReq({ amount: 1000, paymentMethod: WITHHELD_INCOME_TAX, reference: 'KRA-9' }), params)
    const opts = mockRecordPayment.mock.calls[0][0]
    expect(opts.journal('pay-1').lines[0].accountLabel).toBe('1152 - Withholding Tax Credits')
    const create = vi.fn()
    await opts.audit({ taxTransaction: { create } }, { id: 'pay-1' }, [])
    expect(create).not.toHaveBeenCalled()
  })

  it('needs the certificate number', async () => {
    const res = await POST(payReq({ amount: 1000, paymentMethod: WITHHELD_VAT }), params)
    expect(res.status).toBe(422)
    expect(mockRecordPayment).not.toHaveBeenCalled()
  })
})

describe('suggestedWithholding', () => {
  it('is 2% of the amount before VAT: 58,000 incl. VAT → 1,000', () => {
    expect(suggestedWithholding(WITHHELD_VAT, { total: 58000, tax: 8000, amountPaid: 57000 })).toBe(1000)
  })
  it('never more than the balance', () => {
    expect(suggestedWithholding(WITHHELD_VAT, { total: 58000, tax: 8000, amountPaid: 57500 })).toBe(500)
  })
})
