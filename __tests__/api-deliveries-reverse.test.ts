import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockRequireRole, mockLoadAppState, mockSaveStoreKeys, mockWithAppStateKeyLock,
  mockReverseStock, mockReverseJournal, mockMirror,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockWithAppStateKeyLock: vi.fn(async (_key: string, fn: () => Promise<any>) => fn()),
  mockReverseStock: vi.fn(),
  mockReverseJournal: vi.fn(),
  mockMirror: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  requireRole: mockRequireRole,
  withApiErrorHandling: (fn: () => Promise<Response>) => fn(),
}))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: mockWithAppStateKeyLock,
}))
vi.mock('@/lib/inventory/stock-transactions', () => ({ reverseDeliveryStockMutation: mockReverseStock }))
vi.mock('@/lib/accounting/journal-service', () => ({ reverseJournalEntry: mockReverseJournal }))
vi.mock('@/lib/delivery-mirror', () => ({ mirrorDeliveryToPrisma: mockMirror }))

import { POST } from '@/app/api/deliveries/[id]/reverse/route'

const ID = 'delivery-1'
const SERIAL = 'serial-1'
const delivery = (status: string) => ({
  id: ID, ref: 'DN/2026/0195', saleOrderId: 'so-1', status,
  lines: [{ productId: 'prod-1', productName: 'Dell XPS 13', qty: 1, qtyDone: 1, serialIds: [SERIAL] }],
})
const call = (body: Record<string, unknown> = {}) => POST(
  new NextRequest('http://localhost/api/deliveries/delivery-1/reverse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: { id: ID } } as any,
)
const savedDeliveries = () => JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_deliveries)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue({ id: 'user-1', role: 'inventory_officer' })
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockReverseStock.mockResolvedValue(undefined)
  mockReverseJournal.mockResolvedValue({ ref: 'REV/JRN/STK/DEL/DN/2026/0195' })
  mockMirror.mockResolvedValue({ mirrored: true })
})

describe('POST /api/deliveries/:id/reverse', () => {
  it('a delivered note returns its stock, serials and stock journal', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [delivery('done')] })
    const res = await call({ reason: 'Raised in error' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ reversedStock: true, journalReversed: expect.stringContaining('REV/') })
    expect(mockReverseStock).toHaveBeenCalledWith(expect.objectContaining({
      deliveryRef: 'DN/2026/0195', saleOrderId: 'so-1',
      lines: [expect.objectContaining({ productId: 'prod-1', qty: 1, serialIds: [SERIAL] })],
    }))
    expect(mockReverseJournal).toHaveBeenCalledWith('JRN/STK/DEL/DN/2026/0195', 'user-1')
    expect(savedDeliveries()[0]).toMatchObject({ status: 'cancelled', reversedById: 'user-1', reversedReason: 'Raised in error' })
  })

  it('an open delivery is cancelled without crediting stock that never left', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [delivery('ready')] })
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ reversedStock: false })
    expect(mockReverseStock).not.toHaveBeenCalled()
    expect(mockReverseJournal).not.toHaveBeenCalled()
    expect(savedDeliveries()[0].status).toBe('cancelled')
  })

  it('refuses a second reversal', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [delivery('cancelled')] })
    const res = await call()
    expect(res.status).toBe(409)
    expect(mockReverseStock).not.toHaveBeenCalled()
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('404s an unknown delivery', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [] })
    expect((await call()).status).toBe(404)
  })

  it('a failed journal reversal still leaves the stock reversed and the delivery cancelled', async () => {
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [delivery('done')] })
    mockReverseJournal.mockRejectedValue(new Error('no such journal'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ reversedStock: true, journalReversed: null })
    expect(savedDeliveries()[0].status).toBe('cancelled')
    err.mockRestore()
  })

  it('only Director, Inventory and Admin may reverse', async () => {
    const route = await import('@/app/api/deliveries/[id]/reverse/route')
    expect(route).toBeDefined()
    mockLoadAppState.mockResolvedValue({ deed_deliveries: [delivery('done')] })
    await call()
    expect(mockRequireRole).toHaveBeenCalledWith(['director', 'inventory_officer', 'admin_officer'])
  })
})
