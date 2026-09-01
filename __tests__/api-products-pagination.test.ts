import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockPrismaProduct } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrismaProduct: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
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
  requireRole: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: { product: mockPrismaProduct } }))
vi.mock('@/lib/product-catalog-write', () => ({
  publishProduct: vi.fn(),
  toClientProduct: (p: any) => p,
}))
vi.mock('@/lib/validation', () => ({ productSchema: {}, validate: vi.fn() }))

import { GET } from '@/app/api/products/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'u1', role: 'inventory_officer' } })
})

describe('GET /api/products pagination (PERF-001)', () => {
  it('keeps the legacy raw-array shape on the bare boot path', async () => {
    const rows = [{ id: 'p-1', name: 'Laptop' }]
    mockPrismaProduct.findMany.mockResolvedValue(rows)

    const res = await GET(new Request('http://localhost/api/products'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(rows)
    expect(mockPrismaProduct.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ skip: expect.any(Number), take: expect.any(Number) }),
    )
    expect(mockPrismaProduct.count).not.toHaveBeenCalled()
  })

  it('keeps the raw array for the ?lite=1 boot path and skips serial includes', async () => {
    mockPrismaProduct.findMany.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/products?lite=1'))
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
    const call = mockPrismaProduct.findMany.mock.calls[0][0]
    expect(call.include).not.toHaveProperty('serials')
    expect(call).not.toHaveProperty('skip')
  })

  it('returns the paginated envelope with DB-level skip/take when page is given', async () => {
    const rows = [{ id: 'p-26', name: 'Mouse' }]
    mockPrismaProduct.count.mockResolvedValue(120)
    mockPrismaProduct.findMany.mockResolvedValue(rows)

    const res = await GET(new Request('http://localhost/api/products?page=2&limit=25'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: rows, total: 120, page: 2, limit: 25, totalPages: 5 })
    expect(mockPrismaProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25, orderBy: { name: 'asc' } }),
    )
    expect(mockPrismaProduct.count).toHaveBeenCalledWith({ where: {} })
  })

  it('accepts pageSize as an alias for limit', async () => {
    mockPrismaProduct.count.mockResolvedValue(0)
    mockPrismaProduct.findMany.mockResolvedValue([])

    const res = await GET(new Request('http://localhost/api/products?pageSize=10'))
    const body = await res.json()
    expect(body.limit).toBe(10)
    expect(mockPrismaProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    )
  })

  it('pushes search and filters down to the database where clause', async () => {
    mockPrismaProduct.count.mockResolvedValue(3)
    mockPrismaProduct.findMany.mockResolvedValue([])

    const res = await GET(
      new Request('http://localhost/api/products?q=skylake&category=Laptops&active=true&kilimall=1'),
    )
    expect(res.status).toBe(200)
    const where = mockPrismaProduct.findMany.mock.calls[0][0].where
    expect(where.isActive).toBe(true)
    expect(where.isListedKilimall).toBe(true)
    expect(where.category).toEqual({ is: { name: { equals: 'Laptops', mode: 'insensitive' } } })
    expect(where.OR).toHaveLength(4)
    expect(where.OR[0]).toEqual({ name: { contains: 'skylake', mode: 'insensitive' } })
    // count uses the same where so the total matches the filtered page
    expect(mockPrismaProduct.count).toHaveBeenCalledWith({ where })
  })

  it('rejects unallowlisted sort columns and falls back to name', async () => {
    mockPrismaProduct.count.mockResolvedValue(0)
    mockPrismaProduct.findMany.mockResolvedValue([])

    await GET(new Request('http://localhost/api/products?page=1&sort=password&order=desc'))
    expect(mockPrismaProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'desc' } }),
    )
  })
})
