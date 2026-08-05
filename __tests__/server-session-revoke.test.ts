import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNextAuthGetSession, mockResolveStatus } = vi.hoisted(() => ({
  mockNextAuthGetSession: vi.fn(),
  mockResolveStatus: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: mockNextAuthGetSession,
}))

vi.mock('@/lib/auth/auth-options', () => ({
  authOptions: {},
}))

vi.mock('@/lib/auth/session-validity.server', () => ({
  resolveUserSessionStatus: mockResolveStatus,
}))

import { getServerSession } from '@/lib/auth/server'

describe('getServerSession session revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNextAuthGetSession.mockResolvedValue({
      expires: new Date(Date.now() + 3600_000).toISOString(),
      user: {
        id: 'user-1',
        username: 'alice',
        name: 'Alice',
        role: 'sales_rep',
        modules: ['sales'],
        active: true,
        createdAt: '2026-01-01',
      },
    })
  })

  it('returns null when the user was deactivated', async () => {
    mockResolveStatus.mockResolvedValue({ isActive: false, role: 'sales_rep', invalidatedAt: Date.now() })
    await expect(getServerSession()).resolves.toBeNull()
  })

  it('overrides JWT role with the live role from status', async () => {
    mockResolveStatus.mockResolvedValue({ isActive: true, role: 'finance_officer', invalidatedAt: Date.now() })
    const session = await getServerSession()
    expect(session?.user.role).toBe('finance_officer')
    expect(session?.user.active).toBe(true)
  })
})
