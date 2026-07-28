import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    },
    saleOrderItem: {
      update: vi.fn(),
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
    qtyDelivered: 0,
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
  mockLoadAppState.mockResolvedValue({ deed_products: [], deed_invoices: [] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockWriteFinancialAudit.mockResolvedValue(undefined)
  mockPrisma.saleOrder.findUnique.mockResolvedValue(saleOrder)
  mockPrisma.saleOrder.findMany.mockResolvedValue([saleOrder])
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn({
    saleOrder: {
      findUnique: vi.fn().mockResolvedValue(saleOrder),
    },
    saleOrderItem: {
      update: mockPrisma.saleOrderItem.update.mockResolvedValue({}),
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
    const res = await POST(new Request('http://localhost/api/sale-orders/' + ORDER_ID + '/create-invoice', { method: 'POST' }), {
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
    await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    const mirrorCall = mockSaveStoreKeys.mock.calls.find(c => c[0].deed_invoices)
    expect(mirrorCall).toBeTruthy()
    const mirrored = JSON.parse(mirrorCall![0].deed_invoices)
    expect(mirrored[0].lines[0].subtotal).toBe(10000)
    expect(mirrored[0].subtotal).toBe(10000)
    expect(mirrored[0].taxTotal).toBe(1600)
  })

  it('rejects non-sale orders', async () => {
    mockPrisma.saleOrder.findUnique.mockResolvedValue({ ...saleOrder, status: 'quotation' })
    const res = await POST(new Request('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(409)
  })
})
