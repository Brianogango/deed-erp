import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockSaveStoreKeys, mockLoadAppState, mockNotify } = vi.hoisted(() => ({
  mockPrisma: {
    saleOrder: { findMany: vi.fn() },
    quote: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
  mockLoadAppState: vi.fn().mockResolvedValue({}),
  mockNotify: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ saveStoreKeys: mockSaveStoreKeys, loadAppState: mockLoadAppState, notifyStoreKeysChanged: mockNotify }))
vi.mock('@/lib/quote-normalization', () => ({ normalizeQuotesForClient: (rows: any[]) => rows }))

import {
  refreshSaleOrdersBlob,
  refreshQuotesBlob,
  refreshInvoicesBlob,
  refreshDocumentBlobsForClientChange,
} from '@/lib/documents-broadcast.server'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.saleOrder.findMany.mockResolvedValue([])
  mockPrisma.quote.findMany.mockResolvedValue([])
  mockPrisma.invoice.findMany.mockResolvedValue([])
  mockLoadAppState.mockResolvedValue({})
})

describe('refreshSaleOrdersBlob', () => {
  it('picks up the client name currently on the joined record (not a stale copy)', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([
      { id: 'so-1', orderNumber: 'QUO/1', clientId: 'c-1', status: 'quotation', client: { name: 'Renamed Ltd' }, items: [] },
    ])
    await refreshSaleOrdersBlob()
    const call = mockSaveStoreKeys.mock.calls[0][0]
    const written = JSON.parse(call.deed_saleOrders)
    expect(written[0].customerName).toBe('Renamed Ltd')
  })

  it('keeps a sale order that exists only in the store list', async () => {
    mockPrisma.saleOrder.findMany.mockResolvedValue([
      { id: 'so-1', orderNumber: 'QUO/1', clientId: 'c-1', status: 'quotation', client: { name: 'A' }, items: [] },
    ])
    mockLoadAppState.mockResolvedValue({ deed_saleOrders: [{ id: 'so-1' }, { id: 'so-local', ref: 'SO/9' }] })
    await refreshSaleOrdersBlob()
    const written = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_saleOrders)
    expect(written.map((r: any) => r.id)).toEqual(['so-1', 'so-local'])
  })

  it('does not throw when the query fails', async () => {
    mockPrisma.saleOrder.findMany.mockRejectedValue(new Error('db down'))
    await expect(refreshSaleOrdersBlob()).resolves.toBeUndefined()
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})

describe('refreshInvoicesBlob', () => {
  it('no longer rewrites the frozen invoice copy — it only tells open tabs to re-read', async () => {
    await refreshInvoicesBlob()
    expect(mockPrisma.invoice.findMany).not.toHaveBeenCalled()
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(['deed_invoices'])
  })
})

describe('refreshQuotesBlob', () => {
  it('writes the quotes blob', async () => {
    mockPrisma.quote.findMany.mockResolvedValue([{ id: 'q-1' }])
    await refreshQuotesBlob()
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({ deed_quotes: JSON.stringify([{ id: 'q-1' }]) })
  })

  it('keeps a quote that exists only in the store list', async () => {
    mockPrisma.quote.findMany.mockResolvedValue([{ id: 'q-1' }])
    mockLoadAppState.mockResolvedValue({ deed_quotes: [{ id: 'q-1' }, { id: 'q-local' }] })
    await refreshQuotesBlob()
    expect(JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_quotes).map((q: any) => q.id)).toEqual(['q-1', 'q-local'])
  })
})

describe('refreshDocumentBlobsForClientChange', () => {
  it('refreshes all three document blobs', async () => {
    await refreshDocumentBlobsForClientChange()
    expect(mockPrisma.saleOrder.findMany).toHaveBeenCalled()
    expect(mockPrisma.quote.findMany).toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(['deed_invoices'])
  })

  it('one blob failing does not prevent the others from refreshing', async () => {
    mockPrisma.quote.findMany.mockRejectedValue(new Error('quote query failed'))
    await refreshDocumentBlobsForClientChange()
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(expect.objectContaining({ deed_saleOrders: expect.any(String) }))
    expect(mockNotify).toHaveBeenCalledWith(['deed_invoices'])
  })
})
