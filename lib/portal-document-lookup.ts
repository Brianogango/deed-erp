import 'server-only'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

export type PortalDocumentSource = 'quote' | 'sale_order'

export interface PortalDocumentLookup {
  source: PortalDocumentSource
  storeKey: 'deed_quotes' | 'deed_saleOrders'
  items: Record<string, unknown>[]
  index: number
  doc: Record<string, unknown>
}

/**
 * The customer portal (app/portal/quotes/[id]) was built against CRM's
 * deed_quotes model only. In practice, the live "New quotation" flow in the
 * Sales module creates a SaleOrder directly (never a Quote) — so a link
 * generated for an actual, real quotation always pointed at a document type
 * that could never exist for it. generateQuoteToken/verifyQuoteToken are
 * keyed purely on the id string, not the entity type, so the SAME portal
 * URL works for either as long as the backend checks both stores. This
 * resolves an id against deed_quotes first (existing behavior unchanged),
 * then falls back to deed_saleOrders.
 */
export async function findPortalDocument(id: string): Promise<PortalDocumentLookup | null> {
  const state = await loadAppState(['deed_quotes', 'deed_saleOrders'])

  const quotes = Array.isArray(state['deed_quotes']) ? state['deed_quotes'] as Record<string, unknown>[] : []
  const quoteIdx = quotes.findIndex(q => q.id === id)
  if (quoteIdx !== -1) {
    return { source: 'quote', storeKey: 'deed_quotes', items: quotes, index: quoteIdx, doc: quotes[quoteIdx] }
  }

  const saleOrders = Array.isArray(state['deed_saleOrders']) ? state['deed_saleOrders'] as Record<string, unknown>[] : []
  const soIdx = saleOrders.findIndex(o => o.id === id)
  if (soIdx !== -1) {
    return { source: 'sale_order', storeKey: 'deed_saleOrders', items: saleOrders, index: soIdx, doc: saleOrders[soIdx] }
  }

  return null
}

/** Persist an updated item back to whichever store it came from. */
export async function savePortalDocument(lookup: PortalDocumentLookup, updated: Record<string, unknown>): Promise<void> {
  const items = [...lookup.items]
  items[lookup.index] = updated
  await saveStoreKeys({ [lookup.storeKey]: JSON.stringify(items) })
}

/** Statuses from which a customer can still act on a Sales module SaleOrder via the portal. */
export const SALE_ORDER_ACCEPTABLE_STATUSES = new Set(['quotation', 'quotation_sent'])

/** Statuses from which a CRM Quote can still be accepted via the portal (existing behavior). */
export const QUOTE_ACCEPTABLE_STATUSES = new Set(['sent', 'viewed', 'pending_approval'])
