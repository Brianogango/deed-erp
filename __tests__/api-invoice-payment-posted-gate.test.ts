import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression test for the "Only posted invoices can receive payments" bug:
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
}))
vi.mock('@/lib/prisma', () => ({
  default: { invoice: { findUnique: mockFindUnique }, payment: { findFirst: mockFindFirst } },
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
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
vi.mock('@/lib/finance/payment-receipt-notify', () => ({ notifyCustomerPaymentReceived: mockNotify }))

import { POST } from '@/app/api/invoices/[id]/payments/route'

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
  mockResolveMirror.mockResolvedValue({ type: 'customer_invoice', partnerName: 'Amani', clientName: 'Amani' })
  mockRecordPayment.mockResolvedValue({ payment: { id: 'pay-1', paidAt: new Date() }, allocations: [{ id: 'alloc-1' }] })
  mockPostJournal.mockResolvedValue(undefined)
  mockNotify.mockResolvedValue(undefined)
})

describe('POST /api/invoices/[id]/payments — posted-status gate', () => {
  // 'approved'/'invoiced' are what posting persists; the others are legacy
  // payment-progress variants that are still posted documents.
  for (const status of ['approved', 'invoiced', 'posted', 'paid', 'partially_paid', 'overdue']) {
    it(`accepts a payment on posted-family status "${status}"`, async () => {
      mockFindUnique.mockResolvedValue(invoiceWithStatus(status))
      const res = await POST(payReq({ amount: 500, paymentMethod: 'cash' }), { params: { id: 'inv-1' } })
      expect(res.status).toBe(200)
      expect(mockRecordPayment).toHaveBeenCalledTimes(1)
    })
  }

  for (const status of ['draft', 'pending_approval', 'rejected', 'cancelled', 'voided']) {
    it(`rejects a payment on non-posted status "${status}"`, async () => {
      mockFindUnique.mockResolvedValue(invoiceWithStatus(status))
      const res = await POST(payReq({ amount: 500, paymentMethod: 'cash' }), { params: { id: 'inv-1' } })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(String(body.error)).toMatch(/Only posted invoices can receive payments/i)
      expect(mockRecordPayment).not.toHaveBeenCalled()
    })
  }
})
