import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetServerSession, mockLoadAppState, mockSaveStoreKeys, mockWithAppStateKeyLock } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockWithAppStateKeyLock: vi.fn(async (_key: string, fn: () => Promise<any>) => fn()),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: mockWithAppStateKeyLock,
}))

import { makeDetailHandlers } from '@/lib/server-store-crud'

const session = { user: { id: 'user-1', role: 'director' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockWithAppStateKeyLock.mockImplementation(async (_key: string, fn: () => Promise<any>) => fn())
  mockGetServerSession.mockResolvedValue(session)
})

describe('makeDetailHandlers lockKey opt-in', () => {
  it('does not acquire a lock when lockKey is not configured', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const { PATCH } = makeDetailHandlers<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
    })
    const req = new NextRequest('http://localhost/api/widgets/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'b' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: '1' } })
    expect(res.status).toBe(200)
    expect(mockWithAppStateKeyLock).not.toHaveBeenCalled()
  })

  it('acquires the configured lock before reading/writing the collection', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const { PATCH } = makeDetailHandlers<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
      lockKey: 'deed_widgets',
    })
    const req = new NextRequest('http://localhost/api/widgets/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'b' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: '1' } })
    expect(res.status).toBe(200)
    expect(mockWithAppStateKeyLock).toHaveBeenCalledWith('deed_widgets', expect.any(Function))
    expect((await res.json()).item.name).toBe('b')
  })
})
