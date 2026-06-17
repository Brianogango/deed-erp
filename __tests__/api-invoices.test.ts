import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockGetSession, mockRequireRole, mockPrismaInvoice, mockResolveClientId } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockPrismaInvoice: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  mockResolveClientId: vi.fn(),
}))

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

vi.mock('@/lib/prisma', () => ({ default: { invoice: mockPrismaInvoice } }))

vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) => {
    if (typeof v !== 'string') return undefined
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined
  },
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
  status: 'approved',
  subtotal: 5000,
  taxAmount: 800,
  totalAmount: 5800,
  amountPaid: 0,
  invoiceDate: '2026-06-13',
  dueDate: '2026-07-13',
  client: { id: CLIENT_ID, name: 'Acme Ltd' },
  items: [
    {
      id: 'line-1',
      description: 'Service',
      qty: 1,
      unitPrice: 5000,
      taxRate: 16,
      lineSubtotal: 5000,
      lineTax: 800,
      lineTotal: 5800,
    },
  ],
  payments: [],
  createdAt: new Date().toISOString(),
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/invoices', {
    method: 'POST',
    body: JSON.stringify(body),
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
})

// ── GET /api/invoices ─────────────────────────────────────────────────────────
describe('GET /api/invoices', () => {
  it('returns 200 with all invoices', async () => {
    mockPrismaInvoice.findMany.mockResolvedValue([baseInvoice])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(INVOICE_ID)
    expect(body[0]).toMatchObject({
      ref: 'INV-00001',
      type: 'customer_invoice',
      status: 'posted',
      partnerName: 'Acme Ltd',
      date: '2026-06-13',
      total: 5800,
    })
    expect(body[0].lines[0]).toMatchObject({
      description: 'Service',
      subtotal: 5000,
    })
  })

  it('returns empty array when no invoices', async () => {
    mockPrismaInvoice.findMany.mockResolvedValue([])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET()
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

  it('auto-generates invoiceNumber from count when none provided', async () => {
    mockPrismaInvoice.count.mockResolvedValue(7)
    mockPrismaInvoice.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...baseInvoice, invoiceNumber: data.invoiceNumber })
    )
    await POST(postReq({ clientId: CLIENT_ID }))
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

  it('does not use a UUID ref as the invoice number', async () => {
    mockPrismaInvoice.count.mockResolvedValue(11)
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, ref: INVOICE_ID }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invoiceNumber: 'INV-00012' }) })
    )
  })

  it('maps status alias "posted" → "approved"', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, status: 'posted' }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) })
    )
  })

  it('maps status alias "partial" → "partially_paid"', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({ clientId: CLIENT_ID, status: 'partial' }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'partially_paid' }) })
    )
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

  it('derives missing line and invoice totals from qty, price, and tax rate', async () => {
    mockPrismaInvoice.create.mockResolvedValue(baseInvoice)
    await POST(postReq({
      clientId: CLIENT_ID,
      lines: [{ description: 'Screen repair', qty: 2, unitPrice: 1500, taxRate: 16 }],
    }))
    expect(mockPrismaInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotal: 3000,
          taxAmount: 480,
          totalAmount: 3480,
          items: {
            create: [
              expect.objectContaining({
                description: 'Screen repair',
                qty: 2,
                unitPrice: 1500,
                taxRate: 16,
                lineSubtotal: 3000,
                lineTax: 480,
                lineTotal: 3480,
              }),
            ],
          },
        }),
      })
    )
  })

  it('returns 403 for sales_rep (not in invoice WRITE_ROLES)', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await POST(postReq({ clientId: CLIENT_ID }))
    expect(res.status).toBe(403)
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockRejectedValue(err401())
    const res = await POST(postReq({}))
    expect(res.status).toBe(401)
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

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockRejectedValue(err401())
    const res = await GET_ONE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(401)
  })
})

// ── PUT /api/invoices/:id ─────────────────────────────────────────────────────
describe('PUT /api/invoices/:id', () => {
  it('updates an invoice and returns 200', async () => {
    mockPrismaInvoice.update.mockResolvedValue({ ...baseInvoice, status: 'approved' })
    const res = await PUT(idReq(INVOICE_ID, { status: 'posted' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(200)
  })

  it('maps status alias on update (pending → pending_approval)', async () => {
    mockPrismaInvoice.update.mockResolvedValue(baseInvoice)
    await PUT(idReq(INVOICE_ID, { status: 'pending' }), { params: { id: INVOICE_ID } })
    const updateData = mockPrismaInvoice.update.mock.calls[0][0].data
    expect(updateData.status).toBe('pending_approval')
  })

  it('replaces items when lines provided', async () => {
    mockPrismaInvoice.update.mockResolvedValue(baseInvoice)
    const lines = [{ description: 'Service', qty: 1, unitPrice: 5000 }]
    await PUT(idReq(INVOICE_ID, { lines }), { params: { id: INVOICE_ID } })
    const updateData = mockPrismaInvoice.update.mock.calls[0][0].data
    expect(updateData.items).toHaveProperty('deleteMany')
    expect(updateData.items).toHaveProperty('create')
  })

  it('derives item totals on update when only qty and price are supplied', async () => {
    mockPrismaInvoice.update.mockResolvedValue(baseInvoice)
    const lines = [{ desc: 'Consulting', qty: 3, price: 1000, tax: 16 }]
    await PUT(idReq(INVOICE_ID, { lines }), { params: { id: INVOICE_ID } })
    const updateData = mockPrismaInvoice.update.mock.calls[0][0].data
    expect(updateData.items.create).toEqual([
      expect.objectContaining({
        description: 'Consulting',
        lineSubtotal: 3000,
        lineTax: 480,
        lineTotal: 3480,
      }),
    ])
  })

  it('returns 403 for unauthorized role', async () => {
    mockRequireRole.mockRejectedValue(err403())
    const res = await PUT(idReq(INVOICE_ID, {}), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(403)
  })
})

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────
describe('DELETE /api/invoices/:id', () => {
  it('deletes the invoice and returns { ok: true }', async () => {
    mockPrismaInvoice.delete.mockResolvedValue(baseInvoice)
    const res = await DELETE(new Request(`http://localhost/api/invoices/${INVOICE_ID}`, { method: 'DELETE' }), { params: { id: INVOICE_ID } })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
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
