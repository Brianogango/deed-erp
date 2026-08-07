import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockRequireRole,
  mockPrisma,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockGetNextDocNumber,
  mockWriteFinancialAudit,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockPrisma: {
    saleOrder: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    saleOrderItem: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    invoice: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetNextDocNumber: vi.fn(),
  mockWriteFinancialAudit: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))
vi.mock('@/lib/doc-ref-counter', () => ({ getNextDocNumber: mockGetNextDocNumber }))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: mockWriteFinancialAudit }))

import { POST } from '@/app/api/sale-orders/[id]/create-invoice/route'

const ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CLIENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ITEM_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const INVOICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const LINE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

const actor = { id: USER_ID, name: 'Admin', username: 'admin', role: 'admin_officer' }

const saleOrder = {
  id: ORDER_ID,
  orderNumber: 'SO/2026/0001',
  clientId: CLIENT_ID,
  status: 'sale',
  client: { name: 'Acme Ltd' },
  items: [{
    id: ITEM_ID,
    description: 'ThinkPad T14',
    productId: 'prod-1',
    qty: 1,
    qtyDelivered: 1,
    qtyInvoiced: 0,
    unitPrice: 10000,
    taxRate: 16,
    lineTotal: 10000,
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(actor)
  mockGetNextDocNumber.mockResolvedValue('INV/2026/0004')
  mockLoadAppState.mockResolvedValue({
    deed_invoices: [],
    deed_deliveries: [{
      id: 'delivery-1',
      saleOrderId: ORDER_ID,
      status: 'done',
      deliveryNoteGeneratedAt: '2026-07-28T10:00:00.000Z',
      lines: [{ productId: 'prod-1', qty: 1, qtyDone: 1, serialIds: [] }],
    }],
  })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockWriteFinancialAudit.mockResolvedValue(undefined)
  mockPrisma.saleOrder.findUnique.mockResolvedValue(saleOrder)
  mockPrisma.saleOrder.findMany.mockResolvedValue([saleOrder])
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
    saleOrder: {
      findUnique: vi.fn().mockResolvedValue(saleOrder),
    },
    saleOrderItem: {
      updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }),
    },
    invoice: {
      create: mockPrisma.invoice.create.mockResolvedValue({
        id: INVOICE_ID,
        invoiceNumber: 'INV/2026/0004',
        status: 'draft',
        clientId: CLIENT_ID,
        saleOrderId: ORDER_ID,
        subtotal: 10000,
        taxAmount: 1600,
        totalAmount: 11600,
        amountPaid: 0,
        items: [{
          id: LINE_ID,
          description: 'ThinkPad T14 ×1',
          qty: 1,
          unitPrice: 10000,
          taxRate: 16,
          lineSubtotal: 10000,
          lineTax: 1600,
          lineTotal: 11600,
          productId: 'prod-1',
        }],
        client: { name: 'Acme Ltd' },
      }),
    },
  }))
})

describe('POST /api/sale-orders/:id/create-invoice', () => {
  it('returns the full client invoice including lines and pretax subtotals', async () => {
    const res = await POST(new NextRequest('http://localhost/api/sale-orders/' + ORDER_ID + '/create-invoice', { method: 'POST' }), {
      params: { id: ORDER_ID },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.invoice.id).toBe(INVOICE_ID)
    expect(body.invoice.ref).toBe('INV/2026/0004')
    expect(body.invoice.lines).toHaveLength(1)
    expect(body.invoice.lines[0]).toMatchObject({
      id: LINE_ID,
      description: 'ThinkPad T14 ×1',
      qty: 1,
      unitPrice: 10000,
      taxRate: 16,
      subtotal: 10000,
      productId: 'prod-1',
    })
    expect(body.invoice.subtotal).toBe(10000)
    expect(body.invoice.taxTotal).toBe(1600)
    expect(body.invoice.total).toBe(11600)
  })

  it('mirrors pretax line subtotals into deed_invoices (not tax-inclusive lineTotal)', async () => {
    await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    const mirrorCall = mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)
    expect(mirrorCall).toBeTruthy()
    const mirrored = JSON.parse(mirrorCall![0].deed_invoices)
    expect(mirrored[0].lines[0].subtotal).toBe(10000)
    expect(mirrored[0].subtotal).toBe(10000)
    expect(mirrored[0].taxTotal).toBe(1600)
  })

  it('rejects non-sale orders', async () => {
    // No confirmation evidence — quotation number, no confirmedAt, no active DN —
    // so status heal must not promote this to sale.
    mockLoadAppState.mockResolvedValue({ deed_invoices: [], deed_deliveries: [] })
    mockPrisma.saleOrder.findUnique.mockResolvedValue({
      ...saleOrder,
      status: 'quotation',
      orderNumber: 'SQ/2026/0001',
      confirmedAt: null,
    })
    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(409)
    expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled()
  })

  it('rejects invoicing before the delivery is validated (Done)', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_invoices: [],
      deed_deliveries: [{ saleOrderId: ORDER_ID, status: 'ready', lines: [{ productId: 'prod-1', qty: 1, qtyDone: 1 }] }],
    })
    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Validate the delivery/i)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a hollow Done delivery with delivered qty 0', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_invoices: [],
      deed_deliveries: [{
        saleOrderId: ORDER_ID,
        status: 'done',
        lines: [{ productId: 'prod-1', qty: 1, qtyDone: 0, serialIds: [] }],
      }],
    })
    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Validate the delivery/i)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('allows invoicing after Done validation without a printed Delivery Note', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_invoices: [],
      deed_deliveries: [{
        saleOrderId: ORDER_ID,
        status: 'done',
        lines: [{ productId: 'prod-1', qty: 1, qtyDone: 1, serialIds: [] }],
      }],
    })
    const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(200)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })

  it('invoices delivered quantity only after the validated-delivery gate', async () => {
    const partial = {
      ...saleOrder,
      items: [{ ...saleOrder.items[0], qty: 3, qtyDelivered: 1 }],
    }
    mockPrisma.saleOrder.findUnique.mockResolvedValue(partial)
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
      saleOrder: { findUnique: vi.fn().mockResolvedValue(partial) },
      saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
      invoice: { create: mockPrisma.invoice.create },
    }))
    await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    const createData = mockPrisma.invoice.create.mock.calls.at(-1)?.[0]?.data
    expect(createData.items.create[0].qty).toBe(1)
  })

  describe('partial-invoice line overrides', () => {
    it('caps a requested override qty at the line’s invoiceable maximum', async () => {
      const partial = {
        ...saleOrder,
        items: [{ ...saleOrder.items[0], qty: 3, qtyDelivered: 3, qtyInvoiced: 0 }],
      }
      mockPrisma.saleOrder.findUnique.mockResolvedValue(partial)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
        saleOrder: { findUnique: vi.fn().mockResolvedValue(partial) },
        saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
        invoice: { create: mockPrisma.invoice.create },
      }))
      const res = await POST(
        new NextRequest('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: [{ itemId: ITEM_ID, qty: 999 }] }),
        }),
        { params: { id: ORDER_ID } },
      )
      expect(res.status).toBe(200)
      const createData = mockPrisma.invoice.create.mock.calls.at(-1)?.[0]?.data
      expect(createData.items.create[0].qty).toBe(3)
    })

    it('only invoices lines explicitly listed in the override, leaving others untouched', async () => {
      const otherItemId = '11111111-1111-1111-1111-111111111111'
      const twoLine = {
        ...saleOrder,
        items: [
          saleOrder.items[0],
          { ...saleOrder.items[0], id: otherItemId, productId: 'prod-2', description: 'Mouse' },
        ],
      }
      mockPrisma.saleOrder.findUnique.mockResolvedValue(twoLine)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
        saleOrder: { findUnique: vi.fn().mockResolvedValue(twoLine) },
        saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
        invoice: { create: mockPrisma.invoice.create },
      }))
      const res = await POST(
        new NextRequest('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: [{ itemId: ITEM_ID, qty: 1 }] }),
        }),
        { params: { id: ORDER_ID } },
      )
      expect(res.status).toBe(200)
      const createData = mockPrisma.invoice.create.mock.calls.at(-1)?.[0]?.data
      expect(createData.items.create).toHaveLength(1)
      expect(mockPrisma.saleOrderItem.updateMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.saleOrderItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: ITEM_ID }) }),
      )
    })

    it('rejects an override payload with nothing selected', async () => {
      const res = await POST(
        new NextRequest('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: [{ itemId: ITEM_ID, qty: 0 }] }),
        }),
        { params: { id: ORDER_ID } },
      )
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/select at least one line/i)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('line discount proration', () => {
    // Regression: item.lineTotal already bakes in a per-line discount
    // (qty x unitPrice x (1 - discountPct/100)), but create-invoice used to
    // rebuild each invoice line from raw unitPrice x qty, silently dropping
    // that discount. 3 units @ 1000 with a 10% line discount => lineTotal
    // 2700 (not 3000) on the sale order item.
    const discountedItem = { ...saleOrder.items[0], qty: 3, qtyDelivered: 3, unitPrice: 1000, lineTotal: 2700 }

    it('prorates the full discounted lineTotal, not raw unitPrice x qty, on a full invoice', async () => {
      const withDiscount = { ...saleOrder, items: [discountedItem] }
      mockPrisma.saleOrder.findUnique.mockResolvedValue(withDiscount)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
        saleOrder: { findUnique: vi.fn().mockResolvedValue(withDiscount) },
        saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
        invoice: { create: mockPrisma.invoice.create },
      }))
      await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
      const createData = mockPrisma.invoice.create.mock.calls.at(-1)?.[0]?.data
      const line = createData.items.create[0]
      expect(line.qty).toBe(3)
      // Not 3000 (raw unitPrice x qty) — the 10% line discount must survive.
      expect(line.lineSubtotal).toBe(2700)
      expect(line.unitPrice).toBe(900)
    })

    it('prorates a discounted line proportionally on a partial invoice', async () => {
      const withDiscount = { ...saleOrder, items: [discountedItem] }
      mockPrisma.saleOrder.findUnique.mockResolvedValue(withDiscount)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
        saleOrder: { findUnique: vi.fn().mockResolvedValue(withDiscount) },
        saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
        invoice: { create: mockPrisma.invoice.create },
      }))
      await POST(
        new NextRequest('http://localhost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: [{ itemId: ITEM_ID, qty: 1 }] }),
        }),
        { params: { id: ORDER_ID } },
      )
      const createData = mockPrisma.invoice.create.mock.calls.at(-1)?.[0]?.data
      const line = createData.items.create[0]
      expect(line.qty).toBe(1)
      // 1/3 of the discounted 2700 total, not 1000 (raw unitPrice).
      expect(line.lineSubtotal).toBe(900)
      expect(line.unitPrice).toBe(900)
    })
  })

  describe('header discount proration', () => {
    it('prorates the sale order header discount into the invoice total', async () => {
      const discounted = { ...saleOrder, discountAmount: 1000 }
      mockPrisma.saleOrder.findUnique.mockResolvedValue(discounted)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
        saleOrder: { findUnique: vi.fn().mockResolvedValue(discounted) },
        saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
        invoice: { create: mockPrisma.invoice.create },
      }))
      await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
      // Single line, fully invoiced this round → the full header discount applies.
      const createData = mockPrisma.invoice.create.mock.calls.at(-1)?.[0]?.data
      expect(createData.discountAmount).toBe(1000)
      expect(createData.totalAmount).toBe(10000 + 1600 - 1000)
    })

    it('never lets the prorated discount push the invoice below zero', async () => {
      const discounted = { ...saleOrder, discountAmount: 999999 }
      mockPrisma.saleOrder.findUnique.mockResolvedValue(discounted)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
        saleOrder: { findUnique: vi.fn().mockResolvedValue(discounted) },
        saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 1 }) },
        invoice: { create: mockPrisma.invoice.create },
      }))
      const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
      const body = await res.json()
      expect(body.error).toMatch(/at least KES 1/i)
    })
  })

  describe('concurrent double-invoice protection', () => {
    it('rolls back the whole transaction when a concurrent request already bumped qtyInvoiced', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          saleOrder: { findUnique: vi.fn().mockResolvedValue(saleOrder) },
          saleOrderItem: { updateMany: mockPrisma.saleOrderItem.updateMany.mockResolvedValue({ count: 0 }) },
          invoice: { create: mockPrisma.invoice.create },
        }
        return fn(tx)
      })
      const res = await POST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
      expect(res.status).toBe(500)
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled()
    })
  })

})
