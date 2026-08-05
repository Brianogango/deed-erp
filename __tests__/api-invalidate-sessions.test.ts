import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockFindById,
  mockInvalidate,
  mockPublish,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFindById: vi.fn(),
  mockInvalidate: vi.fn().mockResolvedValue(undefined),
  mockPublish: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/lib/auth/users-repository', () => ({
  findAuthUserById: mockFindById,
}))

vi.mock('@/lib/auth/session-validity', () => ({
  invalidateUserSessions: mockInvalidate,
  publishSessionStatus: mockPublish,
}))

import { POST } from '@/app/api/admin/invalidate-sessions/route'

const director = { user: { id: 'd1', role: 'director', username: 'dir', name: 'Dir' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(director)
})

describe('POST /api/admin/invalidate-sessions', () => {
  it('publishes live status for an existing user', async () => {
    mockFindById.mockResolvedValue({ id: 'u1', active: true, role: 'sales_rep' })
    const res = await POST(new Request('http://localhost/api/admin/invalidate-sessions', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
      headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledWith('u1', expect.objectContaining({
      isActive: true,
      role: 'sales_rep',
    }))
  })

  it('marks missing users inactive', async () => {
    mockFindById.mockResolvedValue(null)
    const res = await POST(new Request('http://localhost/api/admin/invalidate-sessions', {
      method: 'POST',
      body: JSON.stringify({ userId: 'gone' }),
      headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(200)
    expect(mockInvalidate).toHaveBeenCalledWith('gone', { isActive: false })
  })

  it('returns 403 for non-admin roles', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 't1', role: 'technician', username: 't', name: 'T' } })
    const res = await POST(new Request('http://localhost/api/admin/invalidate-sessions', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
      headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(403)
  })
})
