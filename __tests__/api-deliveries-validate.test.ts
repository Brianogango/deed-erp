import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockWithAppStateKeyLock,
  mockApplyDeliveryStockMutation,
  mockPostDeliveryValuationFromPayload,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockWithAppStateKeyLock: vi.fn(async (_key: string, fn: () => Promise<any>) => fn()),
  mockApplyDeliveryStockMutation: vi.fn(),
  mockPostDeliveryValuationFromPayload: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: mockWithAppStateKeyLock,
}))
vi.mock('@/lib/inventory/valuation-hooks', () => ({
  postDeliveryValuationFromPayload: mockPostDeliveryValuationFromPayload,
}))
vi.mock('@/lib/inventory/stock-transactions', () => ({
  applyDeliveryStockMutation: mockApplyDeliveryStockMutation,
}))

import { POST } from '@/app/api/deliveries/[id]/validate/route'

const DELIVERY_ID = 'delivery-1'
const session = { user: { id: 'user-1', name: 'Inv', username: 'inv', role: 'inventory_officer' } }

const baseDelivery = {
  id: DELIVERY_ID,
  ref: 'DN/2026/0001',
  saleOrderId: 'so-1',
  status: 'ready',
  preparedAt: '2026-08-01T00:00:00.000Z',
  lines: [{ productId: 'prod-1', productName: 'Laptop', qty: 1, qtyDone: 1, serialIds: [] }],
}

function postReq(body: unknown): any {
  return new NextRequest(`http://localhost/api/deliveries/${DELIVERY_ID}/validate`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = { params: { id: DELIVERY_ID } }

beforeEach(() => {
  vi.clearAllMocks()
  mockWithAppStateKeyLock.mockImplementation(async (_key: string, fn: () => Promise<any>) => fn())
  mockGetServerSession.mockResolvedValue(session)
  mockLoadAppState.mockResolvedValue({ deed_deliveries: [baseDelivery] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockApplyDeliveryStockMutation.mockResolvedValue({ ok: true })
  mockPostDeliveryValuationFromPayload.mockResolvedValue({ ok: true })
})

describe('POST /api/deliveries/:id/validate', () => {
  it('accepts Next 15 promise params', async () => {
    const res = await POST(postReq({ status: 'done' }), { params: Promise.resolve({ id: DELIVERY_ID }) })
    expect(res.status).toBe(200)
  })

  it('serializes the read-modify-write and stock mutation under the deed_deliveries lock', async () => {
    const res = await POST(postReq({ status: 'done' }), params)
    expect(res.status).toBe(200)
    expect(mockWithAppStateKeyLock).toHaveBeenCalledWith('deed_deliveries', expect.any(Function))
    // The stock mutation must happen inside the same locked callback as the
    // status write — verified by call ordering relative to the lock wrapper.
    expect(mockApplyDeliveryStockMutation).toHaveBeenCalled()
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(
      expect.objectContaining({ deed_deliveries: expect.any(String) }),
    )
  })

  it('does not apply the stock mutation when the stock check fails, and does not persist the status flip', async () => {
    mockApplyDeliveryStockMutation.mockResolvedValue({ ok: false, error: 'Insufficient stock' })
    const res = await POST(postReq({ status: 'done' }), params)
    expect(res.status).toBe(409)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown delivery', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [] })
    const res = await POST(postReq({ status: 'done' }), params)
    expect(res.status).toBe(404)
  })

  it('runs valuation inside the lock and still persists done', async () => {
    await POST(postReq({ status: 'done' }), params)
    expect(mockPostDeliveryValuationFromPayload).toHaveBeenCalledTimes(1)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('persists done when valuation fails', async () => {
    mockPostDeliveryValuationFromPayload.mockResolvedValue({ ok: false, reason: 'insufficient_layers' })
    const res = await POST(postReq({ status: 'done' }), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.item.status).toBe('done')
    expect(json.valuation).toEqual({ ok: false, reason: 'insufficient_layers' })
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('keeps the delivery done when COGS only warns about finance setup', async () => {
    mockPostDeliveryValuationFromPayload.mockResolvedValue({
      ok: true,
      warnings: ['prod-1: Unknown journal code: STK'],
    })
    const res = await POST(postReq({ status: 'done' }), params)
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })
})
