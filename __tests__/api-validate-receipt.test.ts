import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetServerSession,
  mockLoadAppState,
  mockLoadAppStateForWrite,
  mockSaveStoreKeys,
  mockWithAppStateKeyLock,
  mockApplyReceiptStockMutation,
  mockPostReceiptValuationFromPayload,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockLoadAppStateForWrite: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockWithAppStateKeyLock: vi.fn(async (_key: string, fn: () => Promise<any>) => fn()),
  mockApplyReceiptStockMutation: vi.fn(),
  mockPostReceiptValuationFromPayload: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  loadAppStateForWrite: mockLoadAppStateForWrite,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: mockWithAppStateKeyLock,
}))
vi.mock('@/lib/inventory/stock-transactions', () => ({
  applyReceiptStockMutation: mockApplyReceiptStockMutation,
}))
vi.mock('@/lib/inventory/valuation-hooks', () => ({
  postReceiptValuationFromPayload: mockPostReceiptValuationFromPayload,
}))

import { POST } from '@/app/api/inventory/validate-receipt/route'

const session = { user: { id: 'user-1', role: 'inventory_officer' } }
const receipt = { id: 'r1', ref: 'GRN/2026/0001', status: 'draft' }
const purchaseOrder = { id: 'po1', lines: [{ productId: 'prod-1', unitPrice: 1000, qty: 1 }] }
const line = { productId: 'prod-1', productName: 'ThinkPad', qtyReceived: 1, requiresSerial: false }

function postReq(payload: unknown) {
  return new NextRequest('http://localhost/api/inventory/validate-receipt', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })
}

const applyBody = {
  applyStock: true,
  destination: 'warehouse',
  receiptId: 'r1',
  receiptRef: 'GRN/2026/0001',
  purchaseOrderId: 'po1',
  lines: [line],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(session)
  mockWithAppStateKeyLock.mockImplementation(async (_key: string, fn: () => Promise<any>) => fn())
  mockLoadAppState.mockResolvedValue({
    deed_serials: [],
    deed_receipts: [receipt],
    deed_purchaseOrders: [purchaseOrder],
  })
  mockLoadAppStateForWrite.mockResolvedValue({
    deed_receipts: [receipt],
    deed_purchaseOrders: [purchaseOrder],
  })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockApplyReceiptStockMutation.mockResolvedValue({ ok: true, moves: [{ id: 'm1' }] })
  mockPostReceiptValuationFromPayload.mockResolvedValue({ ok: true, warnings: [] })
})

describe('POST /api/inventory/validate-receipt', () => {
  it('keeps stock and validates the GRN when valuation fails closed', async () => {
    mockPostReceiptValuationFromPayload.mockResolvedValue({
      ok: false,
      reason: 'Invalid `prisma.journalEntry.create()` invocation: The column `analytic_account_id` of relation `journal_entry_lines` does not exist in the current database',
    })
    const res = await POST(postReq(applyBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stockApplied).toBe(true)
    expect(json.finalized.receipt.status).toBe('validated')
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('keeps stock and validates the GRN when valuation throws', async () => {
    mockPostReceiptValuationFromPayload.mockRejectedValue(new Error('Unknown journal code: STK'))
    const res = await POST(postReq(applyBody))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stockApplied).toBe(true)
    expect(json.finalized.receipt.status).toBe('validated')
  })
})
