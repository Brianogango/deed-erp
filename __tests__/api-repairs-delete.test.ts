import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetServerSession, mockLoadAppState, mockSaveStoreKeys, mockRepairDeleteMany } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockRepairDeleteMany: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
}))

// The relational row is what reads actually serve — deed_repairs_v2 is
// overlaid from it. Mocking only the store layer is why this suite passed
// while a deleted repair came straight back on the next page load.
vi.mock('@/lib/prisma', () => ({
  default: { repair: { deleteMany: mockRepairDeleteMany } },
}))

import { DELETE } from '@/app/api/repairs/[id]/route'

const request = new NextRequest('http://localhost/api/repairs/repair-1', {
  method: 'DELETE',
})

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAppState.mockResolvedValue({
    deed_repairs_v2: [{
      id: 'repair-1',
      ref: 'REP/2026/0001',
      assignedTechnicianId: 'tech-1',
      createdByUserId: 'lead-1',
    }],
  })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockRepairDeleteMany.mockResolvedValue({ count: 1 })
})

describe('DELETE /api/repairs/[id]', () => {
  it('allows a director to permanently delete a repair', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'director-1', role: 'director', name: 'Director' },
    })

    const response = await DELETE(request, { params: { id: 'repair-1' } })

    expect(response.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({ deed_repairs_v2: '[]' })
  })

  it('removes the relational row too, so the repair cannot reappear', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'director-1', role: 'director', name: 'Director' },
    })

    await DELETE(request, { params: { id: 'repair-1' } })

    expect(mockRepairDeleteMany).toHaveBeenCalledTimes(1)
    const where = mockRepairDeleteMany.mock.calls[0][0].where
    expect(where.OR).toEqual(expect.arrayContaining([
      { jobNumber: 'repair-1' },
      { payload: { path: ['id'], equals: 'repair-1' } },
    ]))
  })

  it('reports a failure rather than claiming a delete that did not happen', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'director-1', role: 'director', name: 'Director' },
    })
    mockRepairDeleteMany.mockRejectedValue(new Error('connection lost'))

    const response = await DELETE(request, { params: { id: 'repair-1' } })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/reappear/i) })
  })

  it('does not allow a technician to hard-delete a repair', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'tech-1', role: 'technician', name: 'Technician' },
    })

    const response = await DELETE(request, { params: { id: 'repair-1' } })

    expect(response.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})
