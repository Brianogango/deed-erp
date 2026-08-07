import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockLoadAppState = vi.fn()
const mockSaveStoreKeys = vi.fn()

vi.mock('@/lib/server-store', () => ({
  loadAppState: (...args: unknown[]) => mockLoadAppState(...args),
  saveStoreKeys: (...args: unknown[]) => mockSaveStoreKeys(...args),
}))

import { findPortalDocument, savePortalDocument } from '@/lib/portal-document-lookup'

beforeEach(() => {
  vi.clearAllMocks()
  mockSaveStoreKeys.mockResolvedValue(undefined)
})

describe('findPortalDocument', () => {
  it('resolves a CRM Quote id from deed_quotes', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_quotes: [{ id: 'quote-1', ref: 'QUO/0001' }],
      deed_saleOrders: [],
    })
    const found = await findPortalDocument('quote-1')
    expect(found?.source).toBe('quote')
    expect(found?.doc.ref).toBe('QUO/0001')
  })

  // Regression: the live "New quotation" flow in the Sales module creates a
  // SaleOrder directly, never a CRM Quote — a portal link generated for an
  // ACTUAL quotation always pointed at a document type that could never
  // exist for it, so the customer portal was a dead end for real quotes.
  it('falls back to deed_saleOrders when the id is not a CRM Quote', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_quotes: [{ id: 'quote-1' }],
      deed_saleOrders: [{ id: 'so-1', ref: 'SO/2026/0001', status: 'quotation_sent' }],
    })
    const found = await findPortalDocument('so-1')
    expect(found?.source).toBe('sale_order')
    expect(found?.doc.ref).toBe('SO/2026/0001')
  })

  it('returns null when the id matches neither store', async () => {
    mockLoadAppState.mockResolvedValue({ deed_quotes: [], deed_saleOrders: [] })
    const found = await findPortalDocument('missing')
    expect(found).toBeNull()
  })
})

describe('savePortalDocument', () => {
  it('writes back to the store the lookup came from, at the correct index', async () => {
    mockLoadAppState.mockResolvedValue({
      deed_saleOrders: [{ id: 'so-1', notes: 'old' }, { id: 'so-2', notes: 'unrelated' }],
    })
    const found = await findPortalDocument('so-1')
    await savePortalDocument(found!, { ...found!.doc, notes: 'new' })
    expect(mockSaveStoreKeys).toHaveBeenCalledWith({
      deed_saleOrders: JSON.stringify([{ id: 'so-1', notes: 'new' }, { id: 'so-2', notes: 'unrelated' }]),
    })
  })
})
