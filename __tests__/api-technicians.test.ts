import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireRole,
  mockListPublicUsers,
  mockEmployeeFindMany,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockListPublicUsers: vi.fn(),
  mockEmployeeFindMany: vi.fn(),
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
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/auth/users-repository', () => ({
  listPublicUsers: mockListPublicUsers,
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    employee: { findMany: mockEmployeeFindMany },
  },
}))

import { GET } from '@/app/api/technicians/route'

const leadUser = { id: 'lead', name: 'Peter', username: 'leadtech1', role: 'technical_lead' }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(leadUser)
  mockEmployeeFindMany.mockResolvedValue([
    { id: 'e1', isActive: true },
    { id: 'e3', isActive: false },
  ])
  mockListPublicUsers.mockResolvedValue([
    { id: 'lead', name: 'Peter', username: 'leadtech1', role: 'technical_lead', active: true, employeeId: 'e4', modules: ['repair'], email: 'lead@deed.co.ke' },
    { id: 't1', name: 'James', username: 'tech1', role: 'technician', active: true, employeeId: 'e1', modules: ['repair'], email: 'james@deed.co.ke' },
    { id: 't3', name: 'Exited', username: 'tech3', role: 'technician', active: true, employeeId: 'e3', modules: ['repair'], email: 'exited@deed.co.ke' },
    { id: 'sales', name: 'Grace', username: 'sales1', role: 'sales_rep', active: true, employeeId: 'e9', modules: ['sales'], email: 'grace@deed.co.ke' },
  ])
})

describe('GET /api/technicians', () => {
  it('returns assignable technicians without emails for a technical lead', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mockRequireRole).toHaveBeenCalledWith(['director', 'admin_officer', 'technical_lead'])
    const body = await res.json()
    expect(body.technicians.map((t: { id: string }) => t.id).sort()).toEqual(['lead', 't1'])
    expect(body.technicians.every((t: { email?: string }) => t.email == null)).toBe(true)
  })

  it('rejects technicians who are not allowed to assign', async () => {
    mockRequireRole.mockRejectedValue(Object.assign(new Error('Forbidden — insufficient role'), { status: 403 }))
    const res = await GET()
    expect(res.status).toBe(403)
  })
})
