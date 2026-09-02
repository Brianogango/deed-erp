import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetServerSession, mockLoadAppState, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: (_key: string, fn: () => Promise<unknown>) => fn(),
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

  it('does not allow a technician to hard-delete a repair', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'tech-1', role: 'technician', name: 'Technician' },
    })

    const response = await DELETE(request, { params: { id: 'repair-1' } })

    expect(response.status).toBe(403)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})
