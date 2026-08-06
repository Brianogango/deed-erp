import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockPrismaSO, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaSO: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
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
vi.mock('@/lib/server-store', () => ({ saveStoreKeys: mockSaveStoreKeys }))
vi.mock('@/lib/prisma', () => ({
  default: {
    saleOrder: mockPrismaSO,
    $transaction: (fn: any) => fn({ saleOrder: mockPrismaSO }),
  },
}))

import { POST as newVersionPOST } from '@/app/api/sale-orders/[id]/new-version/route'
import { GET as versionsGET } from '@/app/api/sale-orders/[id]/versions/route'

const ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CLIENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const sessionFor = (role: string) => ({ user: { id: USER_ID, name: 'U', username: 'u', role } })

const baseQuotation = {
  id: ORDER_ID,
  orderNumber: 'QUO/2026/0001',
  clientId: CLIENT_ID,
  status: 'quotation',
  versionNumber: 1,
  versionGroupId: null,
  subtotal: 1000, taxAmount: 160, discountAmount: 0, totalAmount: 1160,
  notes: null, pricelist: null, pricelistId: null,
  currencyCode: 'KES', baseCurrencyCode: 'KES', exchangeRateToBase: 1,
  salespersonId: null, salespersonName: null, salesTeam: null,
  customerRef: null, invoiceAddress: null, deliveryAddress: null,
  items: [{ productId: 'prod-1', description: 'Item', qty: 1, unitPrice: 1000, taxRate: 16, lineTotal: 1160, notes: null }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(sessionFor('sales_rep'))
  mockPrismaSO.findUnique.mockResolvedValue(baseQuotation)
  mockPrismaSO.findMany.mockResolvedValue([{ versionNumber: 1 }])
  mockPrismaSO.update.mockResolvedValue({})
  mockPrismaSO.create.mockImplementation(async ({ data }: any) => ({
    id: 'new-version-id',
    ...data,
    client: { name: 'Acme' },
    items: data.items.create,
  }))
})

describe('POST /api/sale-orders/:id/new-version', () => {
  it('creates v2, backfills the root versionGroupId, and suffixes the ref', async () => {
    const res = await newVersionPOST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.orderNumber ?? body.ref).toBe('QUO/2026/0001-V2')
    expect(mockPrismaSO.update).toHaveBeenCalledWith({ where: { id: ORDER_ID }, data: { versionGroupId: ORDER_ID } })
    const createArgs = mockPrismaSO.create.mock.calls[0][0]
    expect(createArgs.data.versionNumber).toBe(2)
    expect(createArgs.data.versionGroupId).toBe(ORDER_ID)
    expect(createArgs.data.status).toBe('quotation')
  })

  it('computes v3 correctly when versioning from an already-versioned row', async () => {
    const v2Source = { ...baseQuotation, id: 'v2-id', orderNumber: 'QUO/2026/0001-V2', versionNumber: 2, versionGroupId: ORDER_ID }
    mockPrismaSO.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'v2-id') return v2Source
      if (where.id === ORDER_ID) return { orderNumber: 'QUO/2026/0001' }
      return null
    })
    mockPrismaSO.findMany.mockResolvedValue([{ versionNumber: 1 }, { versionNumber: 2 }])
    const res = await newVersionPOST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: 'v2-id' } })
    expect(res.status).toBe(201)
    const createArgs = mockPrismaSO.create.mock.calls[0][0]
    expect(createArgs.data.versionNumber).toBe(3)
    expect(createArgs.data.orderNumber).toBe('QUO/2026/0001-V3')
    expect(createArgs.data.versionGroupId).toBe(ORDER_ID)
    // root already has versionGroupId set — must not be re-updated
    expect(mockPrismaSO.update).not.toHaveBeenCalled()
  })

  it('rejects versioning a confirmed Sales Order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ ...baseQuotation, status: 'sale' })
    const res = await newVersionPOST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Duplicate instead/i)
    expect(mockPrismaSO.create).not.toHaveBeenCalled()
  })

  it('rejects a role that cannot create quotations', async () => {
    mockGetSession.mockResolvedValue(sessionFor('technician'))
    const res = await newVersionPOST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(403)
    expect(mockPrismaSO.create).not.toHaveBeenCalled()
  })

  it('404s for a missing order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(null)
    const res = await newVersionPOST(new NextRequest('http://localhost', { method: 'POST' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sale-orders/:id/versions', () => {
  it('returns the full lineage with isLatest computed', async () => {
    mockPrismaSO.findUnique.mockResolvedValue({ id: ORDER_ID, versionGroupId: ORDER_ID })
    mockPrismaSO.findMany.mockResolvedValue([
      { id: ORDER_ID, orderNumber: 'QUO/2026/0001', versionNumber: 1, status: 'quotation', totalAmount: 1160, createdAt: new Date('2026-01-01'), createdBy: { username: 'brian' } },
      { id: 'v2-id', orderNumber: 'QUO/2026/0001-V2', versionNumber: 2, status: 'quotation', totalAmount: 1200, createdAt: new Date('2026-01-02'), createdBy: { username: 'brian' } },
    ])
    const res = await versionsGET(new NextRequest('http://localhost', { method: 'GET' }), { params: { id: 'v2-id' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.versions).toHaveLength(2)
    expect(body.versions[0].isLatest).toBe(false)
    expect(body.versions[1].isLatest).toBe(true)
    expect(body.versions[1].ref).toBe('QUO/2026/0001-V2')
  })

  it('404s for a missing order', async () => {
    mockPrismaSO.findUnique.mockResolvedValue(null)
    const res = await versionsGET(new NextRequest('http://localhost', { method: 'GET' }), { params: { id: ORDER_ID } })
    expect(res.status).toBe(404)
  })
})
