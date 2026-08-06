import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRequireRole, mockUpdateContactById, mockRefresh } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockUpdateContactById: vi.fn(),
  mockRefresh: vi.fn().mockResolvedValue(undefined),
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
  getRequiredSession: vi.fn(),
  requireRole: mockRequireRole,
}))
vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/contact-prisma', () => ({
  updateContactById: mockUpdateContactById,
  deleteContactById: vi.fn(),
  clientToContact: (c: unknown) => c,
}))
vi.mock('@/lib/documents-broadcast.server', () => ({
  refreshDocumentBlobsForClientChange: mockRefresh,
}))

import { PUT } from '@/app/api/contacts/[id]/route'

const CONTACT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'user-1', role: 'director' })
})

describe('PUT /api/contacts/:id', () => {
  it('refreshes quote/invoice/sale-order blobs after a successful update', async () => {
    mockUpdateContactById.mockResolvedValue({ id: CONTACT_ID, name: 'Renamed Ltd' })
    const res = await PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({ name: 'Renamed Ltd' }) }), { params: { id: CONTACT_ID } })
    expect(res.status).toBe(200)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the update is rejected with a validation error', async () => {
    mockUpdateContactById.mockResolvedValue('Duplicate email')
    const res = await PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({}) }), { params: { id: CONTACT_ID } })
    expect(res.status).toBe(422)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('does not refresh when the contact is not found', async () => {
    mockUpdateContactById.mockResolvedValue(null)
    const res = await PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify({}) }), { params: { id: CONTACT_ID } })
    expect(res.status).toBe(404)
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
