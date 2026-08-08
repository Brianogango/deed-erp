import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockLoadAppState,
  mockSaveStoreKeys,
  mockWriteFinancialAudit,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
  mockWriteFinancialAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
}))
vi.mock('@/lib/finance-audit', () => ({ writeFinancialAudit: mockWriteFinancialAudit }))

import { DELETE } from '@/app/api/purchase-orders/[id]/route'

const PO_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ID = '11111111-2222-3333-4444-555555555555'
const session = { user: { id: USER_ID, name: 'Director', username: 'director', role: 'director' } }

const draftPo = {
  id: PO_ID,
  ref: 'PO/2026/0001',
  status: 'draft',
  supplierId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  lines: [],
  lockVersion: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session)
  mockLoadAppState.mockResolvedValue({ deed_purchaseOrders: [draftPo] })
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

describe('DELETE /api/purchase-orders/:id', () => {
  it('soft-cancels a draft PO (keeps record in blob)', async () => {
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.item.status).toBe('cancelled')
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    const saved = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_purchaseOrders)
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe(PO_ID)
    expect(saved[0].status).toBe('cancelled')
    expect(mockWriteFinancialAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel_purchase_order', entityType: 'purchase_order', entityId: PO_ID }),
    )
  })

  it('returns 409 for a received PO', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{ ...draftPo, status: 'received' }],
    })
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(409)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('returns 409 when PO has receiptIds', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_purchaseOrders: [{ ...draftPo, status: 'confirmed', receiptIds: ['rcpt-1'] }],
    })
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(409)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing PO', async () => {
    mockLoadAppState.mockResolvedValue({ deed_purchaseOrders: [] })
    const res = await DELETE(new NextRequest(`http://localhost/api/purchase-orders/${PO_ID}`, { method: 'DELETE' }), {
      params: { id: PO_ID },
    })
    expect(res.status).toBe(404)
  })
})
