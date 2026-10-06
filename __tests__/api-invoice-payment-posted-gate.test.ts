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
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: { findUnique: mockFindUnique, update: mockUpdateInvoice },
    payment: { findFirst: mockFindFirst },
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
  mockUpdateInvoice.mockImplementation(async ({ data }: { data?: { status?: string } }) =>
    invoiceWithStatus(data?.status || 'approved'),
  )
})

describe('POST /api/invoices/[id]/payments — posted-status gate', () => {
  // 'approved'/'invoiced' are what posting persists; the others are legacy
  // payment-progress variants that are still posted documents.
  for (const status of ['approved', 'invoiced', 'posted', 'paid', 'partially_paid', 'overdue']) {
    it(`accepts a payment on posted-family status "${status}"`, async () => {
      mockFindUnique.mockResolvedValue(invoiceWithStatus(status))
      const res = await POST(payReq({ amount: 500, paymentMethod: 'cash' }), { params: Promise.resolve({ id: 'inv-1' }) })
      expect(res.status).toBe(200)
      expect(mockRecordPayment).toHaveBeenCalledTimes(1)
    })
  }

  for (const status of ['draft', 'pending_approval', 'rejected', 'cancelled', 'voided']) {
    it(`rejects a payment on non-posted status "${status}"`, async () => {
      mockFindUnique.mockResolvedValue(invoiceWithStatus(status))
      const res = await POST(payReq({ amount: 500, paymentMethod: 'cash' }), { params: Promise.resolve({ id: 'inv-1' }) })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(String(body.error)).toMatch(/Only posted invoices can receive payments/i)
      expect(mockRecordPayment).not.toHaveBeenCalled()
    })
  }

  it('promotes a Prisma draft to payable when the blob invoice is posted', async () => {
    mockFindUnique.mockResolvedValue(invoiceWithStatus('draft'))
    mockResolveMirror.mockResolvedValue({
      type: 'customer_invoice',
      status: 'posted',
      partnerName: 'Leah',
    })
    const res = await POST(payReq({ amount: 4500, paymentMethod: 'mpesa' }), { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(200)
    expect(mockUpdateInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'approved' } }),
    )
    expect(mockRecordPayment).toHaveBeenCalledTimes(1)
  })

  it('does not promote a Prisma draft when the blob is also still draft', async () => {
    mockFindUnique.mockResolvedValue(invoiceWithStatus('draft'))
    mockResolveMirror.mockResolvedValue({ type: 'customer_invoice', status: 'draft' })
    const res = await POST(payReq({ amount: 4500, paymentMethod: 'mpesa' }), { params: Promise.resolve({ id: 'inv-1' }) })
    expect(res.status).toBe(409)
    expect(mockUpdateInvoice).not.toHaveBeenCalled()
    expect(mockRecordPayment).not.toHaveBeenCalled()
  })
})

describe('POST /api/invoices/[id]/payments — which account the receipt debits', () => {
  /** The journal the route hands to recordPaymentWithAllocations. */
  const journalFor = (paymentId = 'pay-1') => {
    const args = mockRecordPayment.mock.calls[0][0] as {
      journal: (id: string) => { journalCode: string; lines: Array<{ accountLabel: string; debit: number }> }
    }
    return args.journal(paymentId)
  }

  beforeEach(() => {
    mockFindUnique.mockResolvedValue(invoiceWithStatus('approved'))
  })

  it('debits customer credits, not petty cash, when a credit is applied', async () => {
    // 'customer_credit' is not a bank method, so it fell through to the
    // cash_mobile default and every applied credit debited 2211 — cash the
    // business never received — while 3313 was never relieved.
    // The invoice total is 1000, so the receipt is capped to it.
    await POST(payReq({ amount: 750, paymentMethod: 'customer_credit' }), { params: Promise.resolve({ id: 'inv-1' }) })
    const journal = journalFor()
    expect(journal.lines[0].accountLabel).toBe('3313 - Customer Credits')
    expect(journal.lines[0].debit).toBe(750)
  })

  it('books a credit application to the general journal, not a cash book', async () => {
    await POST(payReq({ amount: 4500, paymentMethod: 'customer_credit' }), { params: Promise.resolve({ id: 'inv-1' }) })
    expect(journalFor().journalCode).toBe('MISC')
  })

  it('ignores a bank account sent alongside a credit application', async () => {
    // No cash moves, so a stray bankAccountId must not re-point the debit.
    await POST(
      payReq({ amount: 4500, paymentMethod: 'customer_credit', bankAccountId: 'ncba' }),
      { params: Promise.resolve({ id: 'inv-1' }) },
    )
    expect(journalFor().lines[0].accountLabel).toBe('3313 - Customer Credits')
  })

  it('still debits cash for an ordinary mobile-money receipt', async () => {
    await POST(payReq({ amount: 4500, paymentMethod: 'mpesa' }), { params: Promise.resolve({ id: 'inv-1' }) })
    const journal = journalFor()
    expect(journal.lines[0].accountLabel).toBe('2211 - Petty Cash / Mobile Money')
    expect(journal.journalCode).toBe('CSH')
  })

  it('still resolves a named cashbook account for a bank receipt', async () => {
    await POST(
      payReq({ amount: 4500, paymentMethod: 'bank_transfer', bankAccountId: 'ncba' }),
      { params: Promise.resolve({ id: 'inv-1' }) },
    )
    expect(journalFor().lines[0].accountLabel).not.toBe('3313 - Customer Credits')
    expect(journalFor().journalCode).toBe('BNK')
  })
})

describe('POST /api/invoices/[id]/payments — supplier bills', () => {
  const bill = { ...invoiceWithStatus('approved'), invoiceNumber: 'BILL/2026/0007', documentType: 'vendor_bill' }

  it('pays a bill out: Dr Accounts Payable / Cr bank, as a vendor payment, with no customer receipt message', async () => {
    mockFindUnique.mockResolvedValue(bill)
    await POST(payReq({ amount: 600, paymentMethod: 'bank_transfer', bankAccountId: 'ncba' }), { params: Promise.resolve({ id: 'inv-1' }) })
    const args = mockRecordPayment.mock.calls[0][0] as { paymentType: string; journal: (id: string) => { description: string; lines: Array<{ accountLabel: string; debit: number; credit: number }> } }
    expect(args.paymentType).toBe('vendor_payment')
    const journal = args.journal('pay-1')
    expect(journal.lines[0]).toMatchObject({ accountLabel: '3000 - Accounts Payable', debit: 600, credit: 0 })
    expect(journal.lines[1]).toMatchObject({ debit: 0, credit: 600 })
    expect(journal.lines.some(l => l.accountLabel.startsWith('1800'))).toBe(false)
    expect(journal.description).toMatch(/Supplier payment/)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('a bill paid with "customer_credit" is still paid from cash, not customer credits', async () => {
    mockFindUnique.mockResolvedValue(bill)
    await POST(payReq({ amount: 600, paymentMethod: 'customer_credit' }), { params: Promise.resolve({ id: 'inv-1' }) })
    const journal = (mockRecordPayment.mock.calls[0][0] as any).journal('pay-1')
    expect(journal.lines.some((l: any) => l.accountLabel.startsWith('3313'))).toBe(false)
  })
})
