import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  roles: [] as any[],
  inUse: {} as Record<string, number>,
  audit: vi.fn(async (_p: any) => undefined),
  actor: { id: 'dir-1', name: 'Brian', username: 'brian', role: 'director' } as any,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/api', () => ({
  requirePermission: vi.fn(async () => h.actor),
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try { return await handler() } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      return new Response(JSON.stringify({ error: err?.message ?? 'error' }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  },
}))
vi.mock('@/lib/auth/access-audit.server', () => ({ recordRoleChange: h.audit }))
vi.mock('@/lib/auth/access-roles.server', () => ({
  listCustomRoles: vi.fn(async () => h.roles),
  getCustomRole: vi.fn(async (id: string) => h.roles.find(r => r.id === id) ?? null),
  countUsersOnRoles: vi.fn(async () => h.inUse),
  nameIsTaken: vi.fn(async (name: string, except?: string) => h.roles.some(r => r.id !== except && r.name.toLowerCase() === name.toLowerCase())),
  createCustomRole: vi.fn(async (v: any) => {
    const role = { ...v, id: `r${h.roles.length + 1}`, builtIn: false }
    h.roles.push(role)
    return role
  }),
  updateCustomRole: vi.fn(async (id: string, v: any) => {
    const role = h.roles.find(r => r.id === id)
    Object.assign(role, v)
    return role
  }),
  deleteCustomRole: vi.fn(async (id: string) => {
    if (h.inUse[id]) return { deleted: false, inUse: h.inUse[id] }
    h.roles.splice(h.roles.findIndex(r => r.id === id), 1)
    return { deleted: true }
  }),
}))

import { GET, POST } from '@/app/api/access-roles/route'
import { PUT, DELETE } from '@/app/api/access-roles/[id]/route'

const body = { name: 'Cheque clerk', description: '', baseRole: 'admin_officer', modules: ['dashboard', 'accounting'], permissions: ['accounting.cheques.view', 'accounting.cheques.manage'] }
const post = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }))
const put = (id: string, b: unknown) => PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify(b) }), { params: Promise.resolve({ id }) })
const del = (id: string) => DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id }) })

beforeEach(() => { h.roles.length = 0; h.inUse = {}; h.audit.mockClear() })

describe('custom roles API', () => {
  it('creates a role and records it', async () => {
    const res = await post(body)
    expect(res.status).toBe(201)
    expect(h.roles).toHaveLength(1)
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.created' }))
  })

  it('refuses a Director-only permission, a built-in name and a duplicate name', async () => {
    expect((await post({ ...body, permissions: ['manageUsers'] })).status).toBe(422)
    expect((await post({ ...body, name: 'Technician' })).status).toBe(422)
    await post(body)
    expect((await post({ ...body, name: 'cheque CLERK' })).status).toBe(409)
  })

  it('lists built-in and custom roles with how many people are on each', async () => {
    await post(body)
    h.inUse = { r1: 3 }
    const data = await (await GET()).json()
    expect(data.builtIn.length).toBeGreaterThanOrEqual(8)
    expect(data.custom[0].userCount).toBe(3)
  })

  it('updates a role and says how many people it reaches', async () => {
    await post(body)
    h.inUse = { r1: 2 }
    const res = await put('r1', { ...body, permissions: ['accounting.cheques.view'] })
    expect(res.status).toBe(200)
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'role.updated', affectedUsers: 2 }))
  })

  it('will not delete a role while people are on it', async () => {
    await post(body)
    h.inUse = { r1: 1 }
    expect((await del('r1')).status).toBe(409)
    h.inUse = {}
    expect((await del('r1')).status).toBe(200)
    expect((await del('r1')).status).toBe(404)
  })
})
