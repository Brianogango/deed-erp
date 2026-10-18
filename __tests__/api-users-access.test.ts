import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  users: [] as any[],
  audit: vi.fn(async (_p: any) => undefined),
  actor: { id: 'dir-1', name: 'Brian', username: 'brian', role: 'director' } as any,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/api', () => ({
  getRequiredSession: vi.fn(async () => ({ user: h.actor })),
  requirePermission: vi.fn(async () => h.actor),
  sanitizeActor: (u: any) => ({ id: u.id, username: u.username, role: u.role }),
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: h.audit }))
vi.mock('@/lib/integrations/email', () => ({ sendEmail: vi.fn(async () => undefined) }))
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'hash'), passwordMatchesHistory: vi.fn(async () => false) }))
vi.mock('@/lib/auth/users-repository', () => ({
  listAuthUsers: vi.fn(async () => h.users),
  findAuthUserById: vi.fn(async (id: string) => h.users.find(u => u.id === id) ?? null),
  findAuthUserByUsername: vi.fn(async () => null),
  clearFailedLogin: vi.fn(async () => undefined),
  toPublicAuthUser: (u: any) => u,
  updateAuthUser: vi.fn(async (id: string, input: any) => {
    const u = h.users.find(x => x.id === id)
    Object.assign(u, input)
    return u
  }),
  deleteAuthUser: vi.fn(async (id: string) => {
    const i = h.users.findIndex(u => u.id === id)
    return i < 0 ? null : h.users.splice(i, 1)[0]
  }),
  deactivateAuthUser: vi.fn(async (id: string) => {
    const u = h.users.find(x => x.id === id)
    if (!u) return null
    u.active = false
    return u
  }),
  reactivateAuthUser: vi.fn(async (id: string) => {
    const u = h.users.find(x => x.id === id)
    if (!u) return null
    u.active = true
    return u
  }),
}))

import { PATCH, DELETE, POST } from '@/app/api/users/[id]/route'

const person = (over: any) => ({ username: over.id, name: over.id.toUpperCase(), modules: ['dashboard'], active: true, actsAsTechnician: false, passwordHash: 'x', ...over })
const call = (fn: any, id: string, body?: unknown) =>
  fn(new Request('http://x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  h.audit.mockClear()
  h.audit.mockResolvedValue(undefined)
  h.users.length = 0
  h.users.push(
    person({ id: 'dir-1', role: 'director', modules: ['dashboard', 'sales'] }),
    person({ id: 'dir-2', role: 'director' }),
    person({ id: 'rep-1', role: 'sales_rep', modules: ['dashboard', 'sales', 'crm'] }),
  )
})

describe('never leaving the company without a Director', () => {
  it('refuses to demote the last active Director, and records nothing', async () => {
    h.users[1].active = false
    const res = await call(PATCH, 'dir-1', { role: 'finance_officer' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('last active Director')
    expect(h.users[0].role).toBe('director')
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('refuses to deactivate or delete the last active Director', async () => {
    h.users[1].active = false
    expect((await call(POST, 'dir-1', { action: 'deactivate' })).status).toBe(400) // your own account
    h.actor = { ...h.actor, id: 'someone-else' }
    expect((await call(POST, 'dir-1', { action: 'deactivate' })).status).toBe(409)
    expect((await call(DELETE, 'dir-1')).status).toBe(409)
    expect(h.users[0].active).toBe(true)
    h.actor = { id: 'dir-1', name: 'Brian', username: 'brian', role: 'director' }
  })

  it('allows it while another active Director remains', async () => {
    const res = await call(PATCH, 'dir-2', { role: 'sales_rep' })
    expect(res.status).toBe(200)
    expect(h.users[1].role).toBe('sales_rep')
  })
})

describe('keeping a history of access changes', () => {
  it('records role and module changes with before and after', async () => {
    const res = await call(PATCH, 'rep-1', { role: 'finance_officer', modules: ['dashboard', 'sales', 'accounting'] })
    expect(res.status).toBe(200)
    expect(h.audit).toHaveBeenCalledTimes(1)
    const entry = h.audit.mock.calls[0][0]
    expect(entry).toMatchObject({ userId: 'dir-1', action: 'user.access_changed', entityType: 'user', entityId: 'rep-1' })
    expect(entry.oldValues).toMatchObject({ role: 'sales_rep' })
    expect(entry.newValues.summary).toBe('role sales rep → finance officer; gained accounting; lost crm')
    expect(entry.newValues.targetName).toBe('REP-1')
  })

  it('records nothing when nothing about access changed', async () => {
    await call(PATCH, 'rep-1', { name: 'Renamed' })
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('records deactivation, reactivation and deletion', async () => {
    await call(POST, 'rep-1', { action: 'deactivate' })
    await call(POST, 'rep-1', { action: 'reactivate' })
    await call(DELETE, 'rep-1')
    expect(h.audit.mock.calls.map(c => c[0].action)).toEqual(['user.deactivated', 'user.reactivated', 'user.deleted'])
  })

  it('still applies the change if the history cannot be saved', async () => {
    h.audit.mockRejectedValueOnce(new Error('audit down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await call(PATCH, 'rep-1', { role: 'inventory_officer' })
    expect(res.status).toBe(200)
    expect(h.users[2].role).toBe('inventory_officer')
    error.mockRestore()
  })
})
