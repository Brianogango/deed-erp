import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSession, mockPrisma } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    partnerApiKey: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api', async (importOriginal) => {
  const { isRoleAllowed } = await import('@/lib/auth/authorization')
  return {
    withApiErrorHandling: async (handler: () => Promise<any>) => {
      try { return await handler() } catch (err: any) {
        const status = typeof err?.status === 'number' ? err.status : 500
        return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
      }
    },
    requireRole: async (allowed: string[]) => {
      const session = await mockGetSession()
      if (!session) throw Object.assign(new Error('Unauthorized'), { status: 401 })
      if (!isRoleAllowed(session.user.role, allowed)) throw Object.assign(new Error('Forbidden'), { status: 403 })
      return session.user
    },
  }
})
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('server-only', () => ({}))

import { GET, POST } from '@/app/api/partner-keys/route'
import { DELETE } from '@/app/api/partner-keys/[id]/route'

const director = { user: { id: 'u-dir', name: 'Director', username: 'dir', role: 'director' } }
const salesRep = { user: { id: 'u-sales', name: 'Sales', username: 'sales', role: 'sales_rep' } }

const dbKey = {
  id: 'key-1', name: 'Acme', prefix: 'deed_pk_abcd', keyHash: 'x'.repeat(64),
  isActive: true, createdAt: new Date(), lastUsedAt: null, revokedAt: null, createdById: 'u-dir',
}

function postReq(body: unknown) {
  return new Request('http://localhost/api/partner-keys', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.partnerApiKey.findMany.mockResolvedValue([dbKey])
  mockPrisma.partnerApiKey.findUnique.mockResolvedValue(dbKey)
  mockPrisma.partnerApiKey.create.mockImplementation(({ data }: any) => Promise.resolve({ ...dbKey, ...data }))
  mockPrisma.partnerApiKey.update.mockResolvedValue({ ...dbKey, isActive: false })
})

describe('partner key management', () => {
  it('blocks non-admin roles from listing keys', async () => {
    mockGetSession.mockResolvedValue(salesRep)
    expect((await GET()).status).toBe(403)
  })

  it('blocks non-admin roles from creating keys', async () => {
    mockGetSession.mockResolvedValue(salesRep)
    expect((await POST(postReq({ name: 'X' }))).status).toBe(403)
  })

  it('creates a key and returns the plaintext exactly once (only hash stored)', async () => {
    mockGetSession.mockResolvedValue(director)
    const res = await POST(postReq({ name: 'Acme Reseller' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.key).toMatch(/^deed_pk_/)
    const stored = mockPrisma.partnerApiKey.create.mock.calls[0][0].data
    expect(stored.keyHash).toHaveLength(64)
    expect(stored.keyHash).not.toBe(body.key)
    expect(JSON.stringify(stored)).not.toContain(body.key)
    // Listing never exposes hashes or keys
    expect(JSON.stringify(body.item)).not.toContain(stored.keyHash)
  })

  it('requires a partner name', async () => {
    mockGetSession.mockResolvedValue(director)
    expect((await POST(postReq({}))).status).toBe(422)
  })

  it('revokes a key (soft delete)', async () => {
    mockGetSession.mockResolvedValue(director)
    const res = await DELETE(new Request('http://localhost/api/partner-keys/key-1', { method: 'DELETE' }), { params: { id: 'key-1' } })
    expect(res.status).toBe(200)
    const patch = mockPrisma.partnerApiKey.update.mock.calls[0][0].data
    expect(patch.isActive).toBe(false)
    expect(patch.revokedAt).toBeInstanceOf(Date)
  })
})
