import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockRequireRole, mockPrisma } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireRole: vi.fn(),
  mockPrisma: {
    category: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
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
}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { GET, PUT } from '@/app/api/categories/route'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'u1', role: 'director', name: 'Dir', username: 'dir' } })
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'director', name: 'Dir', username: 'dir' })
})

describe('GET /api/categories', () => {
  it('merges saved rates onto the ERP category list', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      { id: 'cat-1', name: 'Laptops', commissionRatePercent: 4, isActive: true },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    const laptops = body.items.find((item: { name: string }) => item.name === 'Laptops')
    const services = body.items.find((item: { name: string }) => item.name === 'Services')
    expect(laptops).toMatchObject({ id: 'cat-1', name: 'Laptops', commissionRatePercent: 4 })
    expect(services).toMatchObject({ name: 'Services', commissionRatePercent: null })
  })
})

describe('PUT /api/categories', () => {
  it('upserts commission rates by category name', async () => {
    mockPrisma.category.findFirst
      .mockResolvedValueOnce({ id: 'cat-1' })
      .mockResolvedValueOnce(null)
    mockPrisma.category.update.mockResolvedValue({
      id: 'cat-1', name: 'Laptops', commissionRatePercent: 5,
    })
    mockPrisma.category.create.mockResolvedValue({
      id: 'cat-2', name: 'Services', commissionRatePercent: 0,
    })

    const res = await PUT(new Request('http://localhost/api/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { name: 'Laptops', commissionRatePercent: 5 },
          { name: 'Services', commissionRatePercent: 0 },
        ],
      }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toEqual([
      { id: 'cat-1', name: 'Laptops', commissionRatePercent: 5 },
      { id: 'cat-2', name: 'Services', commissionRatePercent: 0 },
    ])
    expect(mockPrisma.category.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cat-1' },
      data: { commissionRatePercent: 5 },
    }))
    expect(mockPrisma.category.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Services', commissionRatePercent: 0 }),
    }))
  })

  it('rejects an empty payload', async () => {
    const res = await PUT(new Request('http://localhost/api/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    }))
    expect(res.status).toBe(400)
  })
})
