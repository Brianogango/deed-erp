import { describe, it, expect, vi, beforeEach } from 'vitest'

// Server-side enforcement of the Odoo sales workflow on PUT/PATCH
// /api/sale-orders/[id]: illegal transitions, cancellation blockers,
// lock rules, and server-side stamping.

const {
  mockGetSession,
  mockPrismaSO,
  mockPrismaInvoice,
  mockPrismaClient,
  mockPrismaStockReservation,
  mockResolveClientId,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockWriteFinancialAudit,
  mockReserveStock,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaSO: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockPrismaInvoice: {
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: 0, amountPaid: 0 } }),
  },
  mockPrismaClient: {
    findUnique: vi.fn().mockResolvedValue({ creditLimit: 0, name: 'Acme' }),
  },
  mockPrismaStockReservation: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  mockResolveClientId: vi.fn(),
  mockLoadAppState: vi.fn().mockResolvedValue({}),
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
  mockWriteFinancialAudit: vi.fn().mockResolvedValue(undefined),
  mockReserveStock: vi.fn().mockResolvedValue({ ok: true, reserved: 0 }),
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
  getRequiredSession: mockGetSession,
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    saleOrder: mockPrismaSO,
    invoice: mockPrismaInvoice,
    client: mockPrismaClient,
    stockReservation: mockPrismaStockReservation,
  },
}))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState, saveStoreKeys: mockSaveStoreKeys }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: mockWriteFinancialAudit }))
vi.mock('@/lib/fiscal-lock.server', () => ({
  checkFiscalLock: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/inventory/stock-transactions', () => ({
  reserveStockForSaleOrder: mockReserveStock,
}))
vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) =>
    typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined,
}))

import { PUT, DELETE } from '@/app/api/sale-orders/[id]/route'

const ORDER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const CLIENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

const sessionFor = (role: string) => ({ user: { id: '11111111-2222-3333-4444-555555555555', name: 'U', username: 'u', role } })

const baseOrder = {
  id: ORDER_ID,
  orderNumber: 'QUO/2026/0001',
  clientId: CLIENT_ID,
  status: 'quotation',
  locked: false,
  subtotal: 8400,
  taxAmount: 1600,
  discountAmount: 0,
  totalAmount: 10000,
  amountPaid: 0,
  orderDate: new Date('2026-06-01'),
  client: { id: CLIENT_ID, name: 'Acme Ltd' },
  items: [
    { id: 'item-1', productId: null, description: 'Laptop', qty: 1, unitPrice: 8400, taxRate: 16, lineTotal: 10000 },
  ],
}

// Typed as any: the handler wants NextRequest but only uses .json().
function putReq(body: unknown): any {
  return new Request(`http://localhost/api/sale-orders/${ORDER_ID}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = { params: { id: ORDER_ID } }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(sessionFor('director'))
  mockResolveClientId.mockResolvedValue(CLIENT_ID)
  mockPrismaSO.findMany.mockResolvedValue([])
  mockPrismaInvoice.findMany.mockResolvedValue([])
  mockPrismaClient.findUnique.mockResolvedValue({ creditLimit: 0, name: 'Acme' })
  mockReserveStock.mockResolvedValue({ ok: true, reserved: 0 })
  mockLoadAppState.mockResolvedValue({})
  mockPrismaSO.update.mockImplementation(({ data }: any) => {
    // `items` is a Prisma nested-write object, not the relation payload.
    const { items: _items, ...rest } = data
    return Promise.resolve({ ...baseOrder, ...rest, items: baseOrder.items, client: baseOrder.client })
  })
  mockPrismaSO.findUnique.mockImplementation(() =>
    Promise.resolve({ ...baseOrder, items: baseOrder.items, client: baseOrder.client }),
  )
})

describe('sale-order workflow enforcement (server-side)', () => {
  it('confirms a quotation into a Sales Order and stamps confirmation metadata', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(baseOrder)
    const res = await PUT(putReq({ status: 'sale' }), params)
    expect(res.status).toBe(200)
    const data = mockPrismaSO.update.mock.calls[0][0].data
    expect(data.status).toBe('sale')
    expect(data.confirmedAt).toBeInstanceOf(Date)
    expect(data.confirmedById).toBeDefined()
  })

  it('rejects a Sales Order being pushed back to Quotation Sent', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale' })
    const res = await PUT(putReq({ status: 'quotation_sent' }), params)
    expect(res.status).toBe(409)
    expect(mockPrismaSO.update).not.toHaveBeenCalled()
  })

  it('rejects confirmation by a role without confirm rights', async () => {
    mockGetSession.mockResolvedValue(sessionFor('technical_lead'))
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, notes: 'Repair order' })
    const res = await PUT(putReq({ status: 'sale', notes: 'Repair order' }), params)
    expect(res.status).toBe(409)
    expect(mockPrismaSO.update).not.toHaveBeenCalled()
  })

  it('blocks cancelling a Sales Order that has posted invoices', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale' })
    mockPrismaInvoice.findMany.mockResolvedValue([{ status: 'approved', amountPaid: 0 }])
    const res = await PUT(putReq({ status: 'cancelled' }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/posted invoice/i)
  })

  it('blocks cancelling a Sales Order with completed deliveries', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale' })
    mockLoadAppState.mockResolvedValue({
      deed_deliveries: [{ saleOrderId: ORDER_ID, status: 'done' }],
    })
    const res = await PUT(putReq({ status: 'cancelled' }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/completed deliver/i)
  })

  it('cancels a Sales Order with no dependent records', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale' })
    const res = await PUT(putReq({ status: 'cancelled' }), params)
    expect(res.status).toBe(200)
  })

  it('quotations always cancel freely', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(baseOrder)
    const res = await PUT(putReq({ status: 'cancelled' }), params)
    expect(res.status).toBe(200)
  })

  it('rejects commercial changes to a locked order for non-directors', async () => {
    mockGetSession.mockResolvedValue(sessionFor('sales_rep'))
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale', locked: true })
    const res = await PUT(putReq({ status: 'sale', locked: true, total: 999999, subtotal: 900000 }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/locked/i)
  })

  it('allows fulfilment progress updates on a locked order', async () => {
    mockGetSession.mockResolvedValue(sessionFor('sales_rep'))
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale', locked: true })
    // Same commercial content, only qtyInvoiced changes (invoice ledger).
    const res = await PUT(putReq({
      status: 'sale',
      locked: true,
      subtotal: 8400,
      total: 10000,
      taxTotal: 1600,
      lines: [{ productId: null, description: 'Laptop', qty: 1, unitPrice: 8400, taxRate: 16, lineTotal: 10000, qtyInvoiced: 1 }],
    }), params)
    expect(res.status).toBe(200)
  })

  it('directors may edit a locked order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale', locked: true })
    const res = await PUT(putReq({ status: 'sale', locked: true, total: 12000, subtotal: 11000 }), params)
    expect(res.status).toBe(200)
  })

  it('only directors may unlock a locked order', async () => {
    mockGetSession.mockResolvedValue(sessionFor('sales_rep'))
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale', locked: true })
    const res = await PUT(putReq({ status: 'sale', locked: false }), params)
    expect(res.status).toBe(403)
  })

  it('allows auto-locking as part of confirmation (Lock Confirmed Sales)', async () => {
    mockGetSession.mockResolvedValue(sessionFor('sales_rep'))
    mockPrismaSO.findUnique.mockResolvedValue(baseOrder)
    const res = await PUT(putReq({ status: 'sale', locked: true }), params)
    expect(res.status).toBe(200)
  })

  it('stamps sent metadata when marking Quotation Sent', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(baseOrder)
    const res = await PUT(putReq({ status: 'quotation_sent' }), params)
    expect(res.status).toBe(200)
    const data = mockPrismaSO.update.mock.calls[0][0].data
    expect(data.sentAt).toBeInstanceOf(Date)
  })

  it('persists the sent message on the order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(baseOrder)
    await PUT(putReq({ status: 'quotation_sent', sentMessage: 'Please review the attached quotation.' }), params)
    const data = mockPrismaSO.update.mock.calls[0][0].data
    expect(data.sentMessage).toBe('Please review the attached quotation.')
  })

  it('returns 404 for a missing order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(null)
    const res = await PUT(putReq({ status: 'sale' }), params)
    expect(res.status).toBe(404)
  })
})

// ── DELETE /api/sale-orders/:id (FIN-001 soft-cancel) ─────────────────────────
describe('DELETE /api/sale-orders/:id', () => {
  function deleteReq(): any {
    return new Request(`http://localhost/api/sale-orders/${ORDER_ID}`, { method: 'DELETE' })
  }

  it('soft-cancels a draft quotation (never hard-deletes)', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'quotation' })
    mockPrismaSO.update.mockResolvedValue({ ...baseOrder, status: 'cancelled', client: baseOrder.client, items: baseOrder.items })
    const res = await DELETE(deleteReq(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockPrismaSO.delete).not.toHaveBeenCalled()
    expect(mockPrismaSO.update.mock.calls[0][0].data.status).toBe('cancelled')
    expect(mockWriteFinancialAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel_sale_order', entityType: 'sale_order', entityId: ORDER_ID }),
    )
  })

  it('returns 409 for a confirmed sale order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale', orderNumber: 'SO/2026/0001' })
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [], deed_invoices: [] })
    const res = await DELETE(deleteReq(), params)
    expect(res.status).toBe(409)
    expect(mockPrismaSO.delete).not.toHaveBeenCalled()
    expect(mockPrismaSO.update).not.toHaveBeenCalled()
  })

  it('returns 409 when confirmed SO has a linked invoice', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseOrder, status: 'sale', orderNumber: 'SO/2026/0001' })
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [] })
    mockPrismaInvoice.findMany.mockResolvedValue([{ status: 'posted', amountPaid: 0 }])
    const res = await DELETE(deleteReq(), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(String(body.error)).toMatch(/invoice/i)
    expect(mockPrismaSO.delete).not.toHaveBeenCalled()
  })
})
