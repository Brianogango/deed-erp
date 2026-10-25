import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sessions end when what an account may do changes, or its MFA is reset;
// a privileged role needs an MFA-verified session judged on the live role.
const m = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as { text: string; values: unknown[] }[],
  nextAuthSession: vi.fn(),
  findAuthUserById: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/db', () => ({
  sql: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?')
    if (/^\s*UPDATE users/i.test(text)) m.updates.push({ text, values })
    if (/SELECT[\s\S]*FROM users/i.test(text)) return { rows: m.row ? [m.row] : [] }
    return { rows: [] }
  }),
}))
vi.mock('@/lib/auth/access-roles.server', () => ({ ensureAccessRoleStore: vi.fn(), getAccessRoleMap: vi.fn(async () => new Map()) }))
vi.mock('@/lib/auth/session-validity', () => ({ invalidateUserSessions: vi.fn() }))
vi.mock('@/lib/auth/trusted-browser', () => ({ revokeAllTrustedBrowsers: vi.fn() }))

describe('session version', () => {
  beforeEach(() => {
    vi.resetModules()
    m.updates = []
    m.row = { id: 'u1', username: 'u', name: 'U', role: 'sales_rep', modules_json: '[]', is_active: true, created_at: '2026-01-01', password_hash: 'h', session_version: 3, acts_as_technician: false }
  })

  it('goes up when the role changes, so older sessions end', async () => {
    const { updateAuthUser } = await import('@/lib/auth/users-repository')
    const updated = await updateAuthUser('u1', { role: 'finance_officer' } as any)
    expect(updated?.sessionVersion).toBe(4)
  })

  it('stays when only the name changes', async () => {
    const { updateAuthUser } = await import('@/lib/auth/users-repository')
    const updated = await updateAuthUser('u1', { name: 'New name' } as any)
    expect(updated?.sessionVersion).toBe(3)
  })

  it('goes up on an MFA reset', async () => {
    const { resetUserMfa } = await import('@/lib/auth/mfa')
    await resetUserMfa('u1')
    expect(m.updates.some(u => /session_version = COALESCE\(session_version, 1\) \+ 1/.test(u.text))).toBe(true)
  })
})

describe('getServerSession and privileged MFA', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('next-auth', () => ({ getServerSession: m.nextAuthSession }))
    vi.doMock('@/lib/auth/auth-options', () => ({ authOptions: {} }))
    vi.doMock('@/lib/auth/users-repository', () => ({ findAuthUserById: m.findAuthUserById }))
    m.findAuthUserById.mockResolvedValue({ id: 'u1', username: 'u', name: 'U', role: 'finance_officer', modules: [], active: true, sessionVersion: 2, createdAt: '' })
  })

  it('a session without MFA does not carry a privileged live role when MFA is enforced', async () => {
    vi.stubEnv('MFA_ENFORCE_PRIVILEGED', 'true')
    m.nextAuthSession.mockResolvedValue({ user: { id: 'u1', sessionVersion: 2, mfaVerified: false }, expires: '' })
    const { getServerSession } = await import('@/lib/auth/server')
    expect(await getServerSession()).toBeNull()
    m.nextAuthSession.mockResolvedValue({ user: { id: 'u1', sessionVersion: 2, mfaVerified: true }, expires: '' })
    expect((await getServerSession())?.user.role).toBe('finance_officer')
    vi.unstubAllEnvs()
  })
})
