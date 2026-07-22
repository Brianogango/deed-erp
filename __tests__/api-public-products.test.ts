import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

const { mockPrisma, mockLoadAppState } = vi.hoisted(() => ({
  mockPrisma: {
    partnerApiKey: { findUnique: vi.fn(), update: vi.fn() },
    product: { findMany: vi.fn() },
    serialNumber: { groupBy: vi.fn() },
    stockLevel: { findMany: vi.fn() },
  },
  mockLoadAppState: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState }))
vi.mock('server-only', () => ({}))

import { GET, OPTIONS } from '@/app/api/public/v1/products/route'

const VALID_KEY = 'deed_pk_test-key-0123456789abcdef'
const VALID_HASH = createHash('sha256').update(VALID_KEY).digest('hex')

const productRow = (over: Record<string, unknown> = {}) => ({
  id: 'prod-1', sku: 'SKU-1', barcode: null,
  name: 'HP EliteBook 830 G5', description: 'A laptop',
  sellingPrice: 30000, updatedAt: new Date('2026-07-22T00:00:00Z'),
  category: { name: 'Laptops' },
  ...over,
})

function req(qs = '', headers: Record<string, string> = { authorization: `Bearer ${VALID_KEY}` }) {
  return new Request(`http://localhost/api/public/v1/products${qs}`, { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.partnerApiKey.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.keyHash === VALID_HASH
      ? { id: 'key-1', name: 'Acme', isActive: true, lastUsedAt: null }
      : null))
  mockPrisma.partnerApiKey.update.mockResolvedValue({})
  mockPrisma.product.findMany.mockResolvedValue([productRow()])
  mockPrisma.serialNumber.groupBy.mockResolvedValue([])
  mockPrisma.stockLevel.findMany.mockResolvedValue([])
  mockLoadAppState.mockResolvedValue({
    deed_serials: [
      { productId: 'prod-1', status: 'available' },
      { productId: 'prod-1', status: 'available' },
      { productId: 'prod-1', status: 'sold' },
    ],
    deed_bulkStock: [],
    deed_products: [{ id: 'prod-1', warrantyMonths: 6 }],
  })
})

describe('GET /api/public/v1/products — partner catalog', () => {
  it('rejects requests without a key', async () => {
    const res = await GET(req('', {}))
    expect(res.status).toBe(401)
  })

  it('rejects an unknown key', async () => {
    const res = await GET(req('', { 'x-api-key': 'deed_pk_wrong-key' }))
    expect(res.status).toBe(401)
  })

  it('rejects a revoked key', async () => {
    mockPrisma.partnerApiKey.findUnique.mockResolvedValue({ id: 'key-1', name: 'Acme', isActive: false, lastUsedAt: null })
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns reseller-safe fields only, with live availability', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    const item = body.items[0]
    expect(item).toMatchObject({
      sku: 'SKU-1', name: 'HP EliteBook 830 G5', category: 'Laptops',
      price: 30000, currency: 'KES', warrantyMonths: 6,
      quantityAvailable: 2, inStock: true,
    })
    expect(item).not.toHaveProperty('costPrice')
    expect(item).not.toHaveProperty('cost_price')
    expect(item).not.toHaveProperty('wholesalePrice')
  })

  it('accepts the key via X-API-Key too and sets CORS headers', async () => {
    const res = await GET(req('', { 'x-api-key': VALID_KEY }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('hides out-of-stock items by default and includes them with inStock=all', async () => {
    mockLoadAppState.mockResolvedValue({ deed_serials: [], deed_bulkStock: [], deed_products: [] })
    const hidden = await GET(req())
    expect((await hidden.json()).items).toHaveLength(0)

    const shown = await GET(req('?inStock=all'))
    const body = await shown.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].inStock).toBe(false)
  })

  it('paginates', async () => {
    mockPrisma.product.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => productRow({ id: `prod-${i}`, sku: `SKU-${i}`, name: `Item ${i}` })))
    mockLoadAppState.mockResolvedValue({
      deed_serials: Array.from({ length: 7 }, (_, i) => ({ productId: `prod-${i}`, status: 'available' })),
      deed_bulkStock: [], deed_products: [],
    })
    const res = await GET(req('?page=2&pageSize=3'))
    const body = await res.json()
    expect(body.pagination).toMatchObject({ page: 2, pageSize: 3, total: 7, totalPages: 3 })
    expect(body.items).toHaveLength(3)
  })

  it('counts bulk stock from stock_levels net of reservations', async () => {
    mockPrisma.stockLevel.findMany.mockResolvedValue([{ productId: 'prod-1', qtyOnHand: 10, qtyReserved: 4 }])
    mockLoadAppState.mockResolvedValue({ deed_serials: [], deed_bulkStock: [], deed_products: [] })
    const res = await GET(req())
    const body = await res.json()
    expect(body.items[0].quantityAvailable).toBe(6)
  })

  it('answers CORS preflight', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})
