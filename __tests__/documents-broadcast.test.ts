import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockSaveStoreKeys } = vi.hoisted(() => ({
  mockPrisma: {
    saleOrder: { findMany: vi.fn() },
    quote: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ saveStoreKeys: mockSaveStoreKeys }))
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

  it('does not throw when the query fails', async () => {
    mockPrisma.saleOrder.findMany.mockRejectedValue(new Error('db down'))
    await expect(refreshSaleOrdersBlob()).resolves.toBeUndefined()
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })
})

describe('refreshInvoicesBlob', () => {
  it('derives partnerName from the joined client and type from isVendor', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'INV/1', clientId: 'c-1', status: 'approved', client: { name: 'Renamed Vendor', isVendor: true }, items: [] },
    ])
    await refreshInvoicesBlob()
    const call = mockSaveStoreKeys.mock.calls[0][0]
    const written = JSON.parse(call.deed_invoices)
    expect(written[0].partnerName).toBe('Renamed Vendor')
    expect(written[0].type).toBe('vendor_bill')
    expect(written[0].status).toBe('posted')
  })

  it('maps a customer client to customer_invoice', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-2', invoiceNumber: 'INV/2', clientId: 'c-2', status: 'draft', client: { name: 'Acme', isVendor: false }, items: [] },
    ])
    await refreshInvoicesBlob()
    const written = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_invoices)
    expect(written[0].type).toBe('customer_invoice')
  })
})

describe('refreshQuotesBlob', () => {
  it('writes the quotes blob', async () => {
    mockPrisma.quote.findMany.mockResolvedValue([{ id: 'q-1' }])
    await refreshQuotesBlob()
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({ deed_quotes: JSON.stringify([{ id: 'q-1' }]) })
  })
})

describe('refreshDocumentBlobsForClientChange', () => {
  it('refreshes all three document blobs', async () => {
    await refreshDocumentBlobsForClientChange()
    expect(mockPrisma.saleOrder.findMany).toHaveBeenCalled()
    expect(mockPrisma.quote.findMany).toHaveBeenCalled()
    expect(mockPrisma.invoice.findMany).toHaveBeenCalled()
  })

  it('one blob failing does not prevent the others from refreshing', async () => {
    mockPrisma.quote.findMany.mockRejectedValue(new Error('quote query failed'))
    await refreshDocumentBlobsForClientChange()
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(expect.objectContaining({ deed_saleOrders: expect.any(String) }))
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(expect.objectContaining({ deed_invoices: expect.any(String) }))
  })
})
