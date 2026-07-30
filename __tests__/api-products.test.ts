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

import { POST } from '@/app/api/products/route'

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/products', {
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
      id: 'prod-1',
      ...data,
      sellingPrice: data.sellingPrice,
      reorderLevel: data.reorderLevel,
      createdAt: new Date('2026-07-30T00:00:00Z'),
    }),
  )
})

describe('POST /api/products', () => {
  it('creates a product and maps salePrice/minStock for the client', async () => {
    const res = await POST(postReq({
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
    expect(mockPrisma.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'HP ProBook 450',
        trackingMethod: 'SERIAL',
        trackStock: true,
      }),
    }))
  })

  it('returns 409 instead of 500 when SKU unique constraint races', async () => {
    mockPrisma.product.create.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['sku'] },
    })
    const res = await POST(postReq({
      name: 'Duplicate SKU Laptop',
      sku: 'COLLIDE-1',
      category: 'Laptops',
      salePrice: 1000,
      costPrice: 500,
    }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/SKU/i)
  })

  it('retries once with a fresh SKU when client omitted SKU and create hits P2002', async () => {
    mockPrisma.product.create
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['sku'] } })
      .mockResolvedValueOnce({
        id: 'prod-2',
        name: 'Bulk Row',
        sku: 'BULKROW-RETRY',
        sellingPrice: 100,
        costPrice: 50,
        reorderLevel: 5,
        createdAt: new Date('2026-07-30T00:00:00Z'),
      })

    const res = await POST(postReq({
      name: 'Bulk Row',
      category: 'Accessories',
      salePrice: 100,
      costPrice: 50,
      productKind: 'consumable',
    }))
    expect(res.status).toBe(201)
    expect(mockPrisma.product.create).toHaveBeenCalledTimes(2)
  })

  it('marks service products as untracked stock', async () => {
    await POST(postReq({
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
