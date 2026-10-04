import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockSaveStoreKeys, mockLoadAppState } = vi.hoisted(() => ({
  mockPrisma: {
    saleOrder: { findMany: vi.fn() },
    quote: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
  },
  mockSaveStoreKeys: vi.fn().mockResolvedValue(undefined),
  mockLoadAppState: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/server-store', () => ({ saveStoreKeys: mockSaveStoreKeys, loadAppState: mockLoadAppState }))
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
  it('derives partnerName from the joined client and type from the document', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'BILL/2026/0001', documentType: 'vendor_bill', clientId: 'c-1', status: 'approved', client: { name: 'Renamed Vendor', isVendor: true }, items: [] },
    ])
    await refreshInvoicesBlob()
    const call = mockSaveStoreKeys.mock.calls[0][0]
    const written = JSON.parse(call.deed_invoices)
    expect(written[0].partnerName).toBe('Renamed Vendor')
    expect(written[0].type).toBe('vendor_bill')
    expect(written[0].status).toBe('posted')
  })

  it('keeps an invoice to a contact who is also a vendor under Invoices', async () => {
    // REGRESSION 28-Sep-2026: type came from client.isVendor, so every invoice
    // raised to a customer who also supplies Deed was republished as a bill.
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-3', invoiceNumber: 'INV/2026/0412', documentType: 'customer_invoice', clientId: 'c-3', status: 'approved', client: { name: 'Both Ways Ltd', isVendor: true }, items: [] },
    ])
    await refreshInvoicesBlob()
    const written = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_invoices)
    expect(written[0].type).toBe('customer_invoice')
  })

  it('keeps a bill that exists only in the store list (its table save had failed)', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', invoiceNumber: 'BILL/2026/0001', documentType: 'vendor_bill', clientId: 'c-1', status: 'approved', client: { name: 'V', isVendor: true }, items: [] },
    ])
    mockLoadAppState.mockResolvedValue({
      deed_invoices: [{ id: 'inv-1', ref: 'BILL/2026/0001' }, { id: 'store-only', ref: 'BILL/2026/0010', type: 'vendor_bill', status: 'posted' }],
    })
    await refreshInvoicesBlob()
    const written = JSON.parse(mockSaveStoreKeys.mock.calls[0][0].deed_invoices)
    expect(written.map((r: any) => r.id)).toEqual(['inv-1', 'store-only'])
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
    expect(mockPrisma.invoice.findMany).toHaveBeenCalled()
  })

  it('one blob failing does not prevent the others from refreshing', async () => {
    mockPrisma.quote.findMany.mockRejectedValue(new Error('quote query failed'))
    await refreshDocumentBlobsForClientChange()
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(expect.objectContaining({ deed_saleOrders: expect.any(String) }))
    expect(mockSaveStoreKeys).toHaveBeenCalledWith(expect.objectContaining({ deed_invoices: expect.any(String) }))
  })
})
