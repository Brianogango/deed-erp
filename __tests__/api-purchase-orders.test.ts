import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockGetSession,
  mockPrismaPurchaseOrder,
  mockPrismaClient,
  mockPrismaGrnItem,
  mockResolveClientId,
  mockGetNextDocNumber,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockWriteFinancialAudit,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaPurchaseOrder: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  mockPrismaClient: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  mockPrismaGrnItem: { findMany: vi.fn() },
  mockResolveClientId: vi.fn(),
  mockGetNextDocNumber: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
  mockWriteFinancialAudit: vi.fn().mockResolvedValue(undefined),
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
}))

vi.mock('@/lib/prisma', () => ({
  default: { purchaseOrder: mockPrismaPurchaseOrder, client: mockPrismaClient, grnItem: mockPrismaGrnItem },
}))

vi.mock('@/lib/legacy-compat', () => ({
  resolveClientId: mockResolveClientId,
  optionalUuid: (v: unknown) => {
    if (typeof v !== 'string') return undefined
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined
  },
}))

vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))

vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: mockWriteFinancialAudit }))

// Product resolution/self-heal is covered by its own tests — keep the route
// tests at the route boundary.
vi.mock('@/lib/purchase/po-prisma-sync', () => ({
  resolvePOLineProducts: (items: any[]) => Promise.resolve(items),
  ensurePrismaPurchaseOrder: vi.fn().mockResolvedValue(true),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { GET, POST } from '@/app/api/purchase-orders/route'
import { GET as GET_ONE, PATCH, DELETE } from '@/app/api/purchase-orders/[id]/route'

// ── Shared fixtures ───────────────────────────────────────────────────────────
const VENDOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PO_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const PRODUCT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const ITEM_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

const directorSession = { user: { id: USER_ID, name: 'Director', username: 'director', role: 'director' } }
const salesSession = { user: { id: USER_ID, name: 'Sales', username: 'sales', role: 'sales_rep' } }

const dbPo = {
  id: PO_ID,
  poNumber: 'PO/2026/0001',
  status: 'draft',
  clientId: VENDOR_ID,
  vendor: { id: VENDOR_ID, name: 'Acme Supplies' },
  orderDate: new Date('2026-01-01'),
  expectedDate: null,
  items: [],
  subtotal: 1000,
  taxAmount: 160,
  totalAmount: 1160,
  notes: null,
  lockVersion: 0,
}

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function patchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(directorSession)
  mockResolveClientId.mockResolvedValue(VENDOR_ID)
  mockGetNextDocNumber.mockResolvedValue('PO/2026/0001')
  mockLoadAppState.mockResolvedValue({ deed_purchaseOrders: [] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockPrismaClient.updateMany.mockResolvedValue({ count: 0 })
  mockPrismaGrnItem.findMany.mockResolvedValue([])
})

describe('POST /api/purchase-orders', () => {
  it('creates a PO, resolves the vendor client, and mirrors it into the blob', async () => {
    mockPrismaPurchaseOrder.create.mockResolvedValue(dbPo)

    const res = await POST(postReq({
      vendorName: 'Acme Supplies',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qty: 10, unitPrice: 100, taxRate: 16, subtotal: 1000 }],
      total: 1160,
      taxTotal: 160,
      subtotal: 1000,
    }))

    expect(res.status).toBe(201)
    expect(mockResolveClientId).toHaveBeenCalled()
    expect(mockPrismaClient.updateMany).toHaveBeenCalledWith({
      where: { id: VENDOR_ID, isVendor: false },
      data: { isVendor: true },
    })
    expect(mockPrismaPurchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: VENDOR_ID, poNumber: 'PO/2026/0001' }),
      }),
    )
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_purchaseOrders)
    expect(saved[0].vendorId).toBe(VENDOR_ID)
    expect(saved[0].vendorName).toBe('Acme Supplies')

    const body = await res.json()
    expect(body.ref).toBe('PO/2026/0001')
  })

  it('preserves the client-reserved UUID and PO reference instead of creating a shadow RFQ', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(null)
    mockPrismaPurchaseOrder.create.mockResolvedValue({ ...dbPo, id: PO_ID, poNumber: 'PO/2026/0249' })

    const res = await POST(postReq({
      id: PO_ID,
      ref: 'PO/2026/0249',
      vendorId: VENDOR_ID,
      vendorName: 'Acme Supplies',
      lines: [],
    }))

    expect(res.status).toBe(201)
    expect(mockGetNextDocNumber).not.toHaveBeenCalled()
    expect(mockPrismaPurchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: PO_ID, poNumber: 'PO/2026/0249' }),
      }),
    )
  })

  it('returns the existing PO on a retried POST with the same UUID', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(dbPo)

    const res = await POST(postReq({
      id: PO_ID,
      ref: 'PO/2026/0001',
      vendorId: VENDOR_ID,
      vendorName: 'Acme Supplies',
      lines: [],
    }))

    expect(res.status).toBe(200)
    expect(mockPrismaPurchaseOrder.create).not.toHaveBeenCalled()
    expect(mockGetNextDocNumber).not.toHaveBeenCalled()
    expect((await res.json()).id).toBe(PO_ID)
  })

  it('rejects when neither vendorName nor vendorId is present', async () => {
    const res = await POST(postReq({ lines: [] }))
    expect(res.status).toBe(400)
    expect(mockPrismaPurchaseOrder.create).not.toHaveBeenCalled()
  })

  it('ignores tampered header totals/status/ref and derives them from validated lines', async () => {
    mockPrismaPurchaseOrder.create.mockResolvedValue(dbPo)

    const res = await POST(postReq({
      ref: 'PO/ATTACKER/9999',
      status: 'received',
      vendorName: 'Acme Supplies',
      lines: [{ productId: PRODUCT_ID, productName: 'Widget', qty: 2, unitPrice: 100, taxRate: 16, subtotal: 1, qtyReceived: 999, qtyBilled: 999 }],
      subtotal: 1,
      taxTotal: 0,
      total: 1,
    }))
    expect(res.status).toBe(201)
    const data = mockPrismaPurchaseOrder.create.mock.calls[0][0].data
    expect(data.poNumber).toBe('PO/2026/0001')
    expect(data.status).toBe('draft')
    expect(data.subtotal).toBe(200)
    expect(data.taxAmount).toBe(32)
    expect(data.totalAmount).toBe(232)
    expect(data.items.create[0].qtyReceived).toBe(0)
    expect(data.items.create[0].qtyBilled).toBe(0)
    expect(data.items.create[0].lineTotal).toBe(200)
  })


  it('returns 403 for a role outside WRITE_ROLES', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await POST(postReq({ vendorName: 'Acme Supplies', lines: [] }))
    expect(res.status).toBe(403)
    expect(mockPrismaPurchaseOrder.create).not.toHaveBeenCalled()
  })

  it('preserves passthrough fields (receiptIds, billId) already on the blob record', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{ id: PO_ID, receiptIds: ['rcpt-1'], billId: 'bill-1' }],
    })
    mockPrismaPurchaseOrder.create.mockResolvedValue(dbPo)

    const res = await POST(postReq({ vendorName: 'Acme Supplies', lines: [] }))
    expect(res.status).toBe(201)
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_purchaseOrders)
    expect(saved[0].receiptIds).toEqual(['rcpt-1'])
    expect(saved[0].billId).toBe('bill-1')
  })
})

describe('GET /api/purchase-orders', () => {
  it('lists paginated purchase orders', async () => {
    mockPrismaPurchaseOrder.count.mockResolvedValue(1)
    mockPrismaPurchaseOrder.findMany.mockResolvedValue([dbPo])

    const res = await GET(new NextRequest('http://localhost/api/purchase-orders'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items[0].ref).toBe('PO/2026/0001')
  })
})

describe('PATCH /api/purchase-orders/:id', () => {
  const existingWithItems = {
    ...dbPo,
    lockVersion: 2,
    items: [{ id: ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 6, qtyBilled: 4 }],
  }

  it('preserves qtyReceived/qtyBilled progress across a full-object line replace', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(existingWithItems)
    mockPrismaPurchaseOrder.update.mockResolvedValue(dbPo)

    await PATCH(patchReq({
      lockVersion: 2,
      lines: [{ id: ITEM_ID, productId: PRODUCT_ID, qty: 10, qtyReceived: 0, qtyBilled: 0, unitPrice: 100, taxRate: 16, subtotal: 1000 }],
    }), { params: { id: PO_ID } })

    const updateCall = mockPrismaPurchaseOrder.update.mock.calls[0][0]
    // The line is updated in place (see grn_items_po_item_id_fkey), not recreated.
    expect(updateCall.data.items.update[0].where).toEqual({ id: ITEM_ID })
    expect(updateCall.data.items.update[0].data.qtyReceived).toBe(6)
    expect(updateCall.data.items.update[0].data.qtyBilled).toBe(4)
  })

  it('REGRESSION 24-Sep-2026: a PO with a goods receipt can still be edited', async () => {
    // Replacing the lines wholesale violated grn_items_po_item_id_fkey, so any
    // PO with a receipt against it could not be saved at all.
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(existingWithItems)
    mockPrismaPurchaseOrder.update.mockResolvedValue(dbPo)

    const res = await PATCH(patchReq({
      lockVersion: 2,
      notes: 'Delivery moved to Friday',
      lines: [{ id: ITEM_ID, productId: PRODUCT_ID, qty: 10, unitPrice: 100, taxRate: 16 }],
    }), { params: { id: PO_ID } })

    expect(res.status).toBe(200)
    const data = mockPrismaPurchaseOrder.update.mock.calls[0][0].data
    expect(data.items.create).toEqual([])
    expect(data.items.deleteMany).toBeUndefined()
    expect(data.items.update[0].data).not.toHaveProperty('existingId')
  })

  it('refuses to remove a line that has already been received', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(existingWithItems)
    const res = await PATCH(patchReq({ lockVersion: 2, lines: [] }), { params: { id: PO_ID } })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('already been received') })
    expect(mockPrismaPurchaseOrder.update).not.toHaveBeenCalled()
  })

  it('refuses to remove a line a goods receipt points at, even with no progress recorded', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({
      ...dbPo,
      lockVersion: 2,
      items: [{ id: ITEM_ID, productId: PRODUCT_ID, qtyOrdered: 10, qtyReceived: 0, qtyBilled: 0, description: 'Toner' }],
    })
    mockPrismaGrnItem.findMany.mockResolvedValue([{ poItemId: ITEM_ID }])
    const res = await PATCH(patchReq({ lockVersion: 2, lines: [] }), { params: { id: PO_ID } })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('Toner') })
  })

  it('deletes a line nothing points at, and creates a new one', async () => {
    const UNTOUCHED = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({
      ...dbPo,
      lockVersion: 2,
      items: [{ id: UNTOUCHED, productId: PRODUCT_ID, qtyOrdered: 4, qtyReceived: 0, qtyBilled: 0, description: 'Cable' }],
    })
    mockPrismaPurchaseOrder.update.mockResolvedValue(dbPo)
    mockPrismaGrnItem.findMany.mockResolvedValue([])

    const OTHER_PRODUCT = '11111111-2222-4333-8444-555555555555'
    const res = await PATCH(patchReq({
      lockVersion: 2,
      lines: [{ productId: OTHER_PRODUCT, qty: 2, unitPrice: 50, taxRate: 0 }],
    }), { params: { id: PO_ID } })

    expect(res.status).toBe(200)
    const data = mockPrismaPurchaseOrder.update.mock.calls[0][0].data
    expect(data.items.deleteMany).toEqual({ id: { in: [UNTOUCHED] } })
    expect(data.items.create).toHaveLength(1)
    expect(data.items.create[0]).not.toHaveProperty('existingId')
  })

  it('returns 409 on a lockVersion mismatch', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(existingWithItems)
    const res = await PATCH(patchReq({ lockVersion: 1, notes: 'x' }), { params: { id: PO_ID } })
    expect(res.status).toBe(409)
    expect(mockPrismaPurchaseOrder.update).not.toHaveBeenCalled()
  })

  it('does not allow the edit payload to advance received/billed quantities or supply header totals', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(existingWithItems)
    mockPrismaPurchaseOrder.update.mockResolvedValue(dbPo)

    const res = await PATCH(patchReq({
      lockVersion: 2,
      subtotal: 1,
      taxTotal: 0,
      total: 1,
      lines: [{ id: ITEM_ID, productId: PRODUCT_ID, qty: 10, qtyReceived: 10, qtyBilled: 10, unitPrice: 100, taxRate: 16, subtotal: 1 }],
    }), { params: { id: PO_ID } })

    expect(res.status).toBe(200)
    const data = mockPrismaPurchaseOrder.update.mock.calls[0][0].data
    expect(data.items.update[0].data.qtyReceived).toBe(6)
    expect(data.items.update[0].data.qtyBilled).toBe(4)
    expect(data.subtotal).toBe(1000)
    expect(data.taxAmount).toBe(160)
    expect(data.totalAmount).toBe(1160)
  })

  it('rejects a client attempt to jump a PO into received status', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(existingWithItems)
    const res = await PATCH(patchReq({ lockVersion: 2, status: 'received' }), { params: { id: PO_ID } })
    expect(res.status).toBe(409)
    expect(mockPrismaPurchaseOrder.update).not.toHaveBeenCalled()
  })


  it('returns 403 for a role outside WRITE_ROLES', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await PATCH(patchReq({ notes: 'x' }), { params: { id: PO_ID } })
    expect(res.status).toBe(403)
    expect(mockPrismaPurchaseOrder.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing PO', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(null)
    const res = await PATCH(patchReq({ notes: 'x' }), { params: { id: PO_ID } })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/purchase-orders/:id', () => {
  it('soft-cancels a draft PO and writes a financial audit entry', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({ ...dbPo, items: [] })
    mockPrismaPurchaseOrder.update.mockResolvedValue({ ...dbPo, status: 'cancelled' })

    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.item.status).toBe('cancelled')
    expect(mockWriteFinancialAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel_purchase_order', entityType: 'purchase_order', entityId: PO_ID }),
    )
  })

  it('returns 409 for a received PO', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({ ...dbPo, status: 'received', items: [] })
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(409)
    expect(mockPrismaPurchaseOrder.update).not.toHaveBeenCalled()
  })

  it('returns 409 when any line has been received or billed, regardless of status', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({
      ...dbPo,
      status: 'confirmed',
      items: [{ id: ITEM_ID, qtyOrdered: 10, qtyReceived: 3, qtyBilled: 0 }],
    })
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(409)
  })

  it('returns 404 for a missing PO', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(null)
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(404)
  })

  it('is idempotent for an already-cancelled PO (no further mutation)', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue({ ...dbPo, status: 'cancelled', items: [] })
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(200)
    expect(mockPrismaPurchaseOrder.update).not.toHaveBeenCalled()
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('returns 403 for a role outside WRITE_ROLES', async () => {
    mockGetSession.mockResolvedValue(salesSession)
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(403)
    expect(mockPrismaPurchaseOrder.findUnique).not.toHaveBeenCalled()
  })
})

describe('GET /api/purchase-orders/:id', () => {
  it('returns a single PO mapped to client shape', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(dbPo)
    const res = await GET_ONE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`), { params: { id: PO_ID } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(PO_ID)
    expect(body.vendorId).toBe(VENDOR_ID)
  })

  it('returns 404 for a missing PO', async () => {
    mockPrismaPurchaseOrder.findUnique.mockResolvedValue(null)
    const res = await GET_ONE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`), { params: { id: PO_ID } })
    expect(res.status).toBe(404)
  })
})
