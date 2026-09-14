import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetSession,
  mockRequireRole,
  mockPrismaInvoice,
  mockPrismaInvoiceItem,
  mockPrismaPurchaseOrder,
  mockPrismaPurchaseOrderItem,
  mockResolveClientId,
  mockGetNextDocNumber,
  mockCreateJournalEntryInTx,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockPrismaInvoice: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    delete: vi.fn(),
    count: vi.fn(),
  },
  mockPrismaInvoiceItem: {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
    create: vi.fn(),
  },
  mockPrismaPurchaseOrder: {
    findUnique: vi.fn(),
  },
  mockPrismaPurchaseOrderItem: {
    update: vi.fn(),
  },
  mockResolveClientId: vi.fn(),
  mockGetNextDocNumber: vi.fn(),
  mockCreateJournalEntryInTx: vi.fn().mockResolvedValue({ id: 'je-1' }),
}))

vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const msg = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  getRequiredSession: mockGetSession,
  requireRole: mockRequireRole,
  jsonError: (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    invoice: mockPrismaInvoice,
    purchaseOrder: mockPrismaPurchaseOrder,
    purchaseOrderItem: mockPrismaPurchaseOrderItem,
    $transaction: async (fn: (tx: any) => Promise<any>) =>
      fn({
        invoice: mockPrismaInvoice,
        purchaseOrder: mockPrismaPurchaseOrder,
        purchaseOrderItem: mockPrismaPurchaseOrderItem,
        invoiceItem: mockPrismaInvoiceItem,
        taxTransaction: { upsert: vi.fn() },
        client: { findUnique: vi.fn().mockResolvedValue(null) },
      }),
  },
}))

vi.mock('@/lib/finance-audit', () => ({
  writeFinancialAudit: vi.fn().mockResolvedValue(undefined),
  writeFinancialAuditInTx: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/accounting/invoice-journals', () => ({
  dualWriteInvoiceJournal: vi.fn().mockResolvedValue(undefined),
  postInvoiceJournalToPrisma: vi.fn().mockResolvedValue(undefined),
  reverseInvoiceJournalInPrisma: vi.fn().mockResolvedValue(null),
  postCustomerCreditJournalToPrisma: vi.fn().mockResolvedValue(undefined),
  buildInvoiceJournalInput: vi.fn().mockResolvedValue({
    ref: 'JRN/INV/2026/0001',
    sourceType: 'invoice',
    sourceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    invoiceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    lines: [
      { accountLabel: '1800 - Accounts Receivable', label: 'AR', debit: 1160, credit: 0 },
      { accountLabel: '5000 - Sales Revenue', label: 'Revenue', debit: 0, credit: 1000 },
      { accountLabel: '3301 - Output VAT Payable', label: 'VAT', debit: 0, credit: 160 },
    ],
  }),
  allocateInvoiceJournalRef: vi.fn().mockImplementation(async (ref: string) => ref),
}))

vi.mock('@/lib/accounting/journal-service', () => ({
  createJournalEntryInTx: mockCreateJournalEntryInTx,
  createJournalEntry: vi.fn().mockResolvedValue({ id: 'je-1' }),
  reverseJournalEntry: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/accounting/resolve-invoice-mirror', () => ({
  resolveBlobInvoiceMirror: vi.fn().mockResolvedValue({ type: 'customer_invoice' }),
}))

vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) => {
    if (typeof v !== 'string') return undefined
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined
  },
}))

vi.mock('@/lib/fiscal-lock.server', () => ({
  checkFiscalLock: vi.fn().mockResolvedValue({ ok: true }),
}))

const { mockPostSalesCommissionForInvoice } = vi.hoisted(() => ({
  mockPostSalesCommissionForInvoice: vi.fn(),
}))

vi.mock('@/lib/accounting/sales-commission', () => ({
  postSalesCommissionForInvoice: mockPostSalesCommissionForInvoice,
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/invoices/route'
import { GET as GET_ONE, PUT, DELETE } from '@/app/api/invoices/[id]/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const CLIENT_ID   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const INVOICE_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID     = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const directorUser = { id: USER_ID, name: 'Director', username: 'director', role: 'director' }
const directorSession = { user: directorUser }
const salesSession = { user: { id: USER_ID, name: 'Sales', username: 'sales', role: 'sales_rep' } }

const baseInvoice = {
  id: INVOICE_ID,
  invoiceNumber: 'INV-00001',
  clientId: CLIENT_ID,
  status: 'draft',
  subtotal: 5000,
  taxAmount: 800,
  totalAmount: 5800,
  amountPaid: 0,
  items: [],
  createdAt: new Date().toISOString(),
}

function postReq(body: Record<string, unknown>): Request {
  // Invoices below a total of 1 are rejected — tests default to a valid total
  // unless they explicitly override it.
  return new Request('http://localhost/api/invoices', {
    method: 'POST',
    body: JSON.stringify({ total: 5800, date: '2026-09-13', dueDate: '2026-10-13', ...body }),
    headers: { 'Content-Type': 'application/json' },
  })
}

function idReq(id: string, body: unknown, method = 'PUT'): Request {
  return new Request(`http://localhost/api/invoices/${id}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function err401() { return Object.assign(new Error('Unauthorized'), { status: 401 }) }
function err403() { return Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(directorSession)
  mockRequireRole.mockResolvedValue(directorUser)
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
  mockPrismaInvoice.count.mockResolvedValue(0)
  mockPrismaInvoice.updateMany.mockResolvedValue({ count: 1 })
  mockPrismaInvoice.findUniqueOrThrow.mockImplementation((...args: any[]) => mockPrismaInvoice.findUnique(...args))
  mockGetNextDocNumber.mockResolvedValue('INV-00001')
  mockPostSalesCommissionForInvoice.mockResolvedValue(undefined)
  mockCreateJournalEntryInTx.mockResolvedValue({ id: 'je-1' })
})

// ── GET /api/invoices ─────────────────────────────────────────────────────────
describe('GET /api/invoices', () => {
  it('returns 200 with paginated invoices', async () => {
    mockPrismaInvoice.findMany.mockResolvedValue([baseInvoice])
    mockPrismaInvoice.count.mockResolvedValue(1)
    const res = await GET(new Request('http://localhost/api/invoices'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(INVOICE_ID)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(50)
  })

  it('returns empty items when no invoices', async () => {
    mockPrismaInvoice.findMany.mockResolvedValue([])
    mockPrismaInvoice.count.mockResolvedValue(0)
    const res = await GET(new Request('http://localhost/api/invoices'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 0, totalPages: 0 })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET(new Request('http://localhost/api/invoices'))
    expect(res.status).toBe(401)
  })
})

// ── POST /api/invoices ────────────────────────────────────────────────────────
describe('POST /api/invoices', () => {
  it('creates an invoice and returns 201', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    const res = await POST(postReq({ clientId: CLIENT_ID }))
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe(INVOICE_ID)
  })

  it('auto-generates invoiceNumber from the atomic counter when none provided', async () => {
    mockGetNextDocNumber.mockResolvedValue('INV-00008')
    mockPrismaInvoice.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...baseInvoice, invoiceNumber: data.invoiceNumber })
    )
    await POST(postReq({ clientId: CLIENT_ID }))
    expect(mockGetNextDocNumber).toHaveBeenCalledWith('invoice')
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceNumber: 'INV-00008' }),
      })
    )
  })

  it('uses provided invoiceNumber when given', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, invoiceNumber: 'INV-CUSTOM' }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: 'INV-CUSTOM' }) })
    )
  })

  it('maps status alias "posted" → "approved"', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, status: 'posted' }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) })
    )
  })

  it('collapses legacy payment statuses onto the posted document state', async () => {
    // Payment progress is derived from amount_paid, never stored in status.
    for (const legacy of ['partial', 'paid', 'partially_paid', 'overdue']) {
      mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
      await POST(postReq({ clientId: CLIENT_ID, status: legacy }))
      expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) })
      )
      mockPrismaInvoice.create.mockClear()
    }
  })

  it('maps status alias "open" → "approved"', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, status: 'open' }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) })
    )
  })

  it('passes client-supplied UUID id to Prisma', async () => {
    const customId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    mockPrismaInvoice.create.mockResolvedValue({ ...baseInvoice, id: customId })
    await POST(postReq({ id: customId, clientId: CLIENT_ID }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: customId }) })
    )
  })

  it('ignores non-UUID id (protects DB from bad IDs)', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ id: 'notauuid', clientId: CLIENT_ID }))
    const callData = mockPrismaInvoice.create.mock.calls[0][0].data
    expect(callData.id).toBeUndefined()
  })

  it('always uses session user as createdById (prevents impersonation)', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, createdById: 'attacker-uuid' }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: USER_ID }) })
    )
  })

  it('returns 403 for sales_rep (not in invoice WRITE_ROLES)', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await POST(postReq({ clientId: CLIENT_ID }))
    expect(res.status).toBe(403)
  })

  it('rejects invoices with total below 1', async () => {
    const res = await POST(postReq({ clientId: CLIENT_ID, total: 0 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least 1/i)
    expect(mockPrismaInvoice.create).not.toHaveBeenCalled()
  })

  it('derives the total from lines when no total is supplied', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    const res = await POST(postReq({
      clientId: CLIENT_ID,
      total: undefined,
      lines: [{ description: 'Service', qty: 1, unitPrice: 5000, subtotal: 5000, lineTotal: 5000 }],
    }))
    expect(res.status).toBe(201)
  })

  it('extends allowed roles for repair-linked invoices', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, repairId: 'rep_1', notes: 'Repair REP/2026/001' }))
    expect(mockRequireRole).toHaveBeenCalledWith(expect.arrayContaining(['technical_lead', 'technician']))
  })

  it('extends allowed roles for POS till invoices and posts commission on create', async () => {
    const closerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    mockPrismaInvoice.create.mockResolvedValue({ ...baseInvoice, status: 'approved', saleOrderId: null })
    const res = await POST(postReq({
      clientId: CLIENT_ID,
      isPosInvoice: true,
      status: 'posted',
      salespersonId: closerId,
      notes: 'POS POS/0017',
    }))
    expect(res.status).toBe(201)
    expect(mockRequireRole).toHaveBeenCalledWith(expect.arrayContaining(['sales_rep', 'kilimall_officer']))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPosInvoice: true }) }),
    )
    expect(mockPostSalesCommissionForInvoice).toHaveBeenCalledWith(INVOICE_ID, { salespersonUserId: closerId })
  })

  it('does not post commission for a draft invoice create', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, isPosInvoice: true, status: 'draft' }))
    expect(mockPostSalesCommissionForInvoice).not.toHaveBeenCalled()
  })

  it('does not post commission for a posted repair invoice even with a sale order', async () => {
    const soId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    const repairId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    mockPrismaInvoice.create.mockResolvedValue({
      ...baseInvoice,
      status: 'approved',
      saleOrderId: soId,
      repairId,
    })
    const res = await POST(postReq({
      clientId: CLIENT_ID,
      status: 'posted',
      saleOrderId: soId,
      repairId,
      notes: 'Repair REP/2026/001',
    }))
    expect(res.status).toBe(201)
    expect(mockPostSalesCommissionForInvoice).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockRejectedValue(err401())
    const res = await POST(postReq({}))
    expect(res.status).toBe(401)
  })
})

// ── POST /api/invoices — vendor credit notes (isCreditNote) ──────────────────
describe('POST /api/invoices — isCreditNote', () => {
  it('accepts a negative-total credit note and stores negative totals + purchaseOrderId', async () => {
    const POID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    mockPrismaInvoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...baseInvoice, ...data }))
    const res = await POST(postReq({
      clientId: CLIENT_ID,
      purchaseOrderId: POID,
      isCreditNote: true,
      total: -5800,
      lines: [{ description: 'RETURN: Widget ×2', qty: 2, unitPrice: -2500, subtotal: -5000 }],
    }))
    expect(res.status).toBe(201)
    const data = mockPrismaInvoice.create.mock.calls[0][0].data
    expect(data.totalAmount).toBeLessThan(0)
    expect(data.subtotal).toBeLessThan(0)
    expect(data.purchaseOrderId).toBe(POID)
    expect(data.items.create[0].unitPrice).toBeLessThan(0)
    expect(data.items.create[0].qty).toBe(2)
  })

  it('rejects a credit note with a positive declared total', async () => {
    const res = await POST(postReq({ clientId: CLIENT_ID, isCreditNote: true, total: 5800 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/must not be positive/i)
    expect(mockPrismaInvoice.create).not.toHaveBeenCalled()
  })

  it('still rejects a near-zero credit note total', async () => {
    const res = await POST(postReq({ clientId: CLIENT_ID, isCreditNote: true, total: -0.5 }))
    expect(res.status).toBe(400)
    expect(mockPrismaInvoice.create).not.toHaveBeenCalled()
  })

  it('a regular (non-credit-note) invoice still cannot be created with a negative total', async () => {
    mockPrismaInvoice.create.mockImplementation(({ data }: any) => Promise.resolve({ ...baseInvoice, ...data }))
    const res = await POST(postReq({ clientId: CLIENT_ID, total: -5800 }))
    // Math.max(0, ...) in computeInvoiceTotals floors this to 0, which then
    // fails the >= 1 minimum — negative totals never sneak through as a
    // disguised "invoice" without isCreditNote.
    expect(res.status).toBe(400)
    expect(mockPrismaInvoice.create).not.toHaveBeenCalled()
  })
})

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
describe('GET /api/invoices/:id', () => {
  it('returns 200 with the invoice', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue(baseInvoice)
    const res = await GET_ONE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(INVOICE_ID)
  })

  it('returns 404 when invoice not found', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue(null)
    const res = await GET_ONE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(404)
  })

  it('accepts Next 15 promise params', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue(baseInvoice)
    const res = await GET_ONE(
      new Request(`http://localhost/api/invoices/${INVOICE_ID}`),
      { params: Promise.resolve({ id: INVOICE_ID }) },
    )
    expect(res.status).toBe(200)
    expect(mockPrismaInvoice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INVOICE_ID } }),
    )
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET_ONE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(401)
  })
})

// ── PUT /api/invoices/:id ─────────────────────────────────────────────────────
describe('PUT /api/invoices/:id', () => {
  it('updates an invoice and returns 200', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({ ...baseInvoice, lockVersion: 0 })
    mockPrismaInvoice.update.mockResolvedValue({ ...baseInvoice, status: 'approved', lockVersion: 1 })
    const res = await PUT(idReq(INVOICE_ID, { status: 'posted' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(200)
  })

  it('maps status alias on update (pending → pending_approval)', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({ ...baseInvoice, lockVersion: 0 })
    mockPrismaInvoice.update.mockResolvedValue(baseInvoice)
    await PUT(idReq(INVOICE_ID, { status: 'pending' }), { params: { id: INVOICE_ID } })
    // The guarded write goes through updateMany (optimistic lockVersion).
    const updateData = mockPrismaInvoice.updateMany.mock.calls[0][0].data
    expect(updateData.status).toBe('pending_approval')
  })

  it('replaces items when lines provided', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({ ...baseInvoice, lockVersion: 0 })
    mockPrismaInvoice.update.mockResolvedValue(baseInvoice)
    const lines = [{ description: 'Service', qty: 1, unitPrice: 5000 }]
    await PUT(idReq(INVOICE_ID, { lines }), { params: { id: INVOICE_ID } })
    // Items are replaced via the item table, not a nested invoice update.
    expect(mockPrismaInvoiceItem.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: INVOICE_ID } })
    expect(mockPrismaInvoiceItem.createMany).toHaveBeenCalled()
  })

  it('refuses to wipe existing items with lines:[]', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      items: [{ id: 'li1', description: 'Kept', qty: 1, unitPrice: 5000 }],
    })
    mockPrismaInvoice.update.mockResolvedValue(baseInvoice)
    await PUT(idReq(INVOICE_ID, { lines: [], status: 'posted' }), { params: { id: INVOICE_ID } })
    expect(mockPrismaInvoiceItem.deleteMany).not.toHaveBeenCalled()
    expect(mockPrismaInvoiceItem.createMany).not.toHaveBeenCalled()
  })

  it('returns 403 for unauthorized role', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await PUT(idReq(INVOICE_ID, {}), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(403)
  })

  it('accepts Next 15 promise params when confirming a draft invoice', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      lockVersion: 0,
      items: [{ id: 'li1', description: 'Laptop', qty: 1, unitPrice: 5000, taxRate: 16, taxCategory: 'standard_16', lineSubtotal: 5000, lineTax: 800, lineTotal: 5800 }],
    })
    mockPrismaInvoice.findUniqueOrThrow.mockResolvedValue({ ...baseInvoice, status: 'approved', lockVersion: 1 })
    const res = await PUT(
      idReq(INVOICE_ID, { status: 'posted', date: '2026-09-13' }),
      { params: Promise.resolve({ id: INVOICE_ID }) },
    )
    expect(res.status).toBe(200)
    expect(mockPrismaInvoice.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INVOICE_ID } }),
    )
  })

  it('returns the posting error instead of Internal server error when the GL journal cannot post', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      lockVersion: 0,
      items: [{ id: 'li1', description: 'Laptop', qty: 1, unitPrice: 5000, taxRate: 16, taxCategory: 'standard_16', lineSubtotal: 5000, lineTax: 800, lineTotal: 5800 }],
    })
    mockCreateJournalEntryInTx.mockRejectedValue(
      Object.assign(new Error('Unknown journal code: SAL'), { status: 409 }),
    )
    const res = await PUT(idReq(INVOICE_ID, { status: 'posted', date: '2026-09-13' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Unknown journal code: SAL' })
  })

  it('maps a journal setup failure thrown without status onto 409', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      lockVersion: 0,
      items: [{ id: 'li1', description: 'Laptop', qty: 1, unitPrice: 5000, taxRate: 16, taxCategory: 'standard_16', lineSubtotal: 5000, lineTax: 800, lineTotal: 5800 }],
    })
    mockCreateJournalEntryInTx.mockRejectedValue(new Error('Fiscal period 2026 is draft and cannot accept postings'))
    const res = await PUT(idReq(INVOICE_ID, { status: 'posted', date: '2026-09-13' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Fiscal period 2026/)
  })
})

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────
describe('DELETE /api/invoices/:id', () => {
  it('voids (not hard-deletes) an unpaid invoice and returns { ok: true }', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({ ...baseInvoice, amountPaid: 0 })
    mockPrismaInvoice.update.mockResolvedValue({ ...baseInvoice, status: 'voided' })
    const res = await DELETE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`, { method: 'DELETE' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    // Never hard-deletes — transitions to voided instead.
    expect(mockPrismaInvoice.delete).not.toHaveBeenCalled()
    expect(mockPrismaInvoice.update.mock.calls[0][0].data.status).toBe('voided')
  })

  it('refuses to void a paid invoice (409)', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue({ ...baseInvoice, amountPaid: 5800 })
    const res = await DELETE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`, { method: 'DELETE' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(409)
    expect(mockPrismaInvoice.update).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing invoice', async () => {
    mockPrismaInvoice.findUnique.mockResolvedValue(null)
    const res = await DELETE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`, { method: 'DELETE' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(404)
  })

  it('returns 403 for unauthorized role', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await DELETE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`, { method: 'DELETE' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockRejectedValue(err401())
    const res = await DELETE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`, { method: 'DELETE' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(401)
  })
})

// ── POST /api/invoices — server-side 3-way match ────────────────────────────
describe('POST /api/invoices — server-side 3-way match', () => {
  const PO_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  const PRODUCT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  const PO_ITEM_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

  it('rejects a vendor bill line that exceeds received-minus-billed', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 3, qtyBilled: 0 }],
    })

    const res = await POST(postReq({
      purchaseOrderId: PO_ID,
      lines: [{ productId: PRODUCT_ID, description: 'Widget', qty: 5, unitPrice: 100 }],
      total: 500,
    }))

    expect(res.status).toBe(400)
    expect(mockPrismaInvoice.create).not.toHaveBeenCalled()
    expect(mockPrismaPurchaseOrderItem.update).not.toHaveBeenCalled()
  })

  it('creates the bill and advances PurchaseOrderItem.qtyBilled atomically when qty fits', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 5, qtyBilled: 1 }],
    })
    // qtyBilled is recomputed from live bills — the existing billed qty comes
    // from a prior active bill, not the stale PO counter.
    mockPrismaInvoice.findMany.mockResolvedValue([{ items: [{ productId: PRODUCT_ID, qty: 1 }] }])
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)

    const res = await POST(postReq({
      purchaseOrderId: PO_ID,
      lines: [{ productId: PRODUCT_ID, description: 'Widget', qty: 4, unitPrice: 100 }],
      total: 400,
    }))

    expect(res.status).toBe(201)
    expect(mockPrismaInvoice.create).toHaveBeenCalled()
    expect(mockPrismaPurchaseOrderItem.update).toHaveBeenCalledWith({
      where: { id: PO_ITEM_ID },
      data: { qtyBilled: 5 },
    })
  })

  it('clamps qtyBilled at qtyOrdered rather than overshooting', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({
      id: PO_ID,
      items: [{ id: PO_ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 5, qtyReceived: 5, qtyBilled: 3 }],
    })
    mockPrismaInvoice.findMany.mockResolvedValue([{ items: [{ productId: PRODUCT_ID, qty: 3 }] }])
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)

    const res = await POST(postReq({
      purchaseOrderId: PO_ID,
      lines: [{ productId: PRODUCT_ID, description: 'Widget', qty: 2, unitPrice: 100 }],
      total: 200,
    }))

    expect(res.status).toBe(201)
    expect(mockPrismaPurchaseOrderItem.update).toHaveBeenCalledWith({
      where: { id: PO_ITEM_ID },
      data: { qtyBilled: 5 },
    })
  })

  it('does not enforce 3-way match for a credit note against a PO', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)

    const res = await POST(postReq({
      purchaseOrderId: PO_ID,
      isCreditNote: true,
      lines: [{ productId: PRODUCT_ID, description: 'Widget', qty: 999, unitPrice: 100 }],
      total: -99900,
    }))

    expect(res.status).toBe(201)
    expect(mockPrismaPurchaseOrder.findUnique).not.toHaveBeenCalled()
    expect(mockPrismaPurchaseOrderItem.update).not.toHaveBeenCalled()
  })

  it('creates the invoice normally when the line product is not on the linked PO', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({ id: PO_ID, items: [] })
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)

    const res = await POST(postReq({
      purchaseOrderId: PO_ID,
      lines: [{ productId: PRODUCT_ID, description: 'Ad-hoc item', qty: 2, unitPrice: 50 }],
      total: 100,
    }))

    expect(res.status).toBe(201)
    expect(mockPrismaPurchaseOrderItem.update).not.toHaveBeenCalled()
  })
})
