import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNextAuthGetSession, mockFindAuthUserById } = vi.hoisted(() => ({
  mockNextAuthGetSession: vi.fn(),
  mockFindAuthUserById: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: mockNextAuthGetSession,
}))

vi.mock('@/lib/auth/auth-options', () => ({
  authOptions: {},
}))

vi.mock('@/lib/auth/users-repository', () => ({
  findAuthUserById: mockFindAuthUserById,
}))

import { getServerSession } from '@/lib/auth/server'

const liveUser = {
  id: 'user-1',
  username: 'alice',
  name: 'Alice',
  role: 'sales_rep',
  modules: ['sales'],
  active: true,
  createdAt: '2026-01-01',
  actsAsTechnician: false,
  sessionVersion: 1,
}

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
        sessionVersion: 1,
      },
    })
    mockFindAuthUserById.mockResolvedValue(liveUser)
  })

  it('returns null when the user was deactivated', async () => {
    mockFindAuthUserById.mockResolvedValue({ ...liveUser, active: false })
    await expect(getServerSession()).resolves.toBeNull()
  })

  it('overrides JWT role with the live role from the user row', async () => {
    mockFindAuthUserById.mockResolvedValue({ ...liveUser, role: 'finance_officer' })
    const session = await getServerSession()
    expect(session?.user.role).toBe('finance_officer')
    expect(session?.user.active).toBe(true)
  })
})
