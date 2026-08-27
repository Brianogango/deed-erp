import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockPostReceiptValuationFromBlobs,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockPostReceiptValuationFromBlobs: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))
vi.mock('@/lib/inventory/valuation-hooks', () => ({
  postReceiptValuationFromBlobs: mockPostReceiptValuationFromBlobs,
}))

import { DELETE, PATCH } from '@/app/api/receipts/[id]/route'

const session = { user: { id: 'user-1', name: 'Inv', username: 'inv', role: 'inventory_officer' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session)
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockPostReceiptValuationFromBlobs.mockResolvedValue({ ok: true, results: [] })
})

describe('receipts API fail-closed valuation and delete', () => {
  it('does not persist validated when valuation fails', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_receipts: [{ id: 'r1', status: 'draft', lines: [] }],
    })
    mockPostReceiptValuationFromBlobs.mockResolvedValue({ ok: false, reason: 'valuation_failed' })
    const req = new NextRequest('http://localhost/api/receipts/r1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'validated' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: 'r1' } })
    expect(res.status).toBe(422)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('blocks DELETE of a validated receipt', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_receipts: [{ id: 'r1', status: 'validated' }],
    })
    const req = new NextRequest('http://localhost/api/receipts/r1', { method: 'DELETE' })
    const res = await DELETE(req, { params: { id: 'r1' } })
    expect(res.status).toBe(409)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})
