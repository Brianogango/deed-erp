import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockNotify } = vi.hoisted(() => ({ mockNotify: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/server-store', () => ({ notifyStoreKeysChanged: mockNotify }))

import {
  refreshSaleOrdersBlob,
  refreshQuotesBlob,
  refreshInvoicesBlob,
  refreshDocumentBlobsForClientChange,
} from '@/lib/documents-broadcast.server'

beforeEach(() => vi.clearAllMocks())

// The screens read invoices, sale orders and quotes from their tables and the
// screen copies are frozen, so a "refresh" only tells open tabs to re-read.
describe('document refreshes', () => {
  it('each tells open tabs to re-read its list', async () => {
    await refreshSaleOrdersBlob()
    await refreshQuotesBlob()
    await refreshInvoicesBlob()
    expect(mockNotify.mock.calls.map(c => c[0])).toEqual([['deed_saleOrders'], ['deed_quotes'], ['deed_invoices']])
  })

  it('a contact change refreshes all three, even if one notification fails', async () => {
    mockNotify.mockRejectedValueOnce(new Error('down'))
    await refreshDocumentBlobsForClientChange()
    expect(mockNotify).toHaveBeenCalledTimes(3)
  })
})
