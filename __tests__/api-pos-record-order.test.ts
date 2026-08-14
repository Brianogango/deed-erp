import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockRequireRole,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockWithAppStateKeyLock,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockWithAppStateKeyLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/lib/auth/api', () => ({
  requireRole: mockRequireRole,
  withApiErrorHandling: async (handler: () => Promise<unknown>) => handler(),
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: mockWithAppStateKeyLock,
}))

import { POST } from '@/app/api/pos/record-order/route'

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pos/record-order', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithAppStateKeyLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn())
  mockRequireRole.mockResolvedValue({ id: 'u1', role: 'sales_rep' })
  mockLoadAppState.mockResolvedValue({ deed_posOrders: [{ id: 'old', ref: 'POS/0016', total: 1500 }] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

describe('POST /api/pos/record-order', () => {
  it('unions the new ticket into the existing till list under the posOrders lock', async () => {
    const order = { id: 'new', ref: 'POS/0017', total: 32000, sessionId: 'sess-1' }
    const res = await POST(postReq({ order }))
    expect(res.status).toBe(200)
    expect(mockWithAppStateKeyLock).toHaveBeenCalledWith('deed_posOrders', expect.any(Function))
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_posOrders)
    expect(saved.map((o: { id: string }) => o.id).sort()).toEqual(['new', 'old'])
  })

  it('rejects a payload without id/ref', async () => {
    const res = await POST(postReq({ order: { total: 1 } }))
    expect(res.status).toBe(400)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})
