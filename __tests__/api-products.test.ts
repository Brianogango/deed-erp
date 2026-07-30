import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockRequireRole, mockPrisma } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockPrisma: {
    product: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    category: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const message = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  getRequiredSession: mockGetSession,
  requireRole: mockRequireRole,
  jsonError: (message: string, status = 400) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('server-only', () => ({}))

import { POST as POST_ONE } from '@/app/api/products/route'
import { POST as POST_BULK } from '@/app/api/products/bulk/route'

function postReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'u1', role: 'director', name: 'Dir', username: 'dir' } })
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'director', name: 'Dir', username: 'dir' })
  mockPrisma.product.findFirst.mockResolvedValue(null)
  mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-1', name: 'Laptops' })
  mockPrisma.product.create.mockImplementation(({ data }: any) =>
    Promise.resolve({
      id: `prod-${data.sku}`,
      ...data,
      sellingPrice: data.sellingPrice,
      reorderLevel: data.reorderLevel,
      createdAt: new Date('2026-07-30T00:00:00Z'),
    }),
  )
})

describe('POST /api/products', () => {
  it('creates a product and maps salePrice/minStock for the client', async () => {
    const res = await POST_ONE(postReq('http://localhost/api/products', {
      name: 'HP ProBook 450',
      category: 'Laptops',
      salePrice: 85000,
      costPrice: 72000,
      productKind: 'storable',
      trackingMethod: 'SERIAL',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.salePrice).toBe(85000)
    expect(body.minStock).toBe(5)
    expect(mockPrisma.product.create).toHaveBeenCalled()
  })

  it('returns 409 when product already exists', async () => {
    mockPrisma.product.findFirst.mockResolvedValueOnce({
      id: 'existing', name: 'HP ProBook 450', sku: 'OLD', barcode: null,
    })
    const res = await POST_ONE(postReq('http://localhost/api/products', {
      name: 'HP ProBook 450',
      category: 'Laptops',
      salePrice: 1000,
      costPrice: 500,
    }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already used/i)
  })

  it('marks service products as untracked stock', async () => {
    await POST_ONE(postReq('http://localhost/api/products', {
      name: 'Monthly Support',
      category: 'Services',
      salePrice: 15000,
      costPrice: 0,
      productKind: 'service',
    }))
    expect(mockPrisma.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        trackStock: false,
        trackingMethod: 'NONE',
      }),
    }))
  })
})

describe('POST /api/products/bulk', () => {
  it('publishes new rows and skips ones that already exist', async () => {
    mockPrisma.product.findFirst.mockImplementation(({ where }: any) => {
      // SKU uniqueness probe used by buildUniqueSku
      if (where?.sku) return Promise.resolve(null)
      const nameEquals = where?.OR?.find((clause: any) => clause.name?.equals)?.name?.equals
      if (String(nameEquals).toLowerCase() === 'existing laptop') {
        return Promise.resolve({ id: 'ex', name: 'Existing Laptop', sku: 'EX-1', barcode: null })
      }
      return Promise.resolve(null)
    })

    mockPrisma.product.create.mockResolvedValueOnce({
      id: 'prod-new',
      name: 'Brand New Laptop',
      sku: 'NEW-1',
      sellingPrice: 20000,
      costPrice: 15000,
      reorderLevel: 2,
      createdAt: new Date('2026-07-30T00:00:00Z'),
    })

    const res = await POST_BULK(postReq('http://localhost/api/products/bulk', {
      products: [
        { name: 'Brand New Laptop', category: 'Laptops', salePrice: 20000, costPrice: 15000, minStock: 2 },
        { name: 'Existing Laptop', category: 'Laptops', salePrice: 10000, costPrice: 8000 },
      ],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(1)
    expect(body.skipped).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.products).toHaveLength(1)
    expect(body.skippedRows[0].reason).toMatch(/already used/i)
  })
})
