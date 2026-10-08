import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, notifyStoreKeysChanged, saveStoreKeys } from '@/lib/server-store'
import { mergeInvoiceMirror } from '@/lib/invoice-mirror-merge'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'

export async function refreshSaleOrdersBlob(): Promise<void> {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    // Merge, never replace: an order that only the store list knows about (its
    // table save failed) must survive the refresh. See mergeInvoiceMirror.
    const existing = (await loadAppState(['deed_saleOrders'])).deed_saleOrders
    const { merged, kept } = mergeInvoiceMirror(all.map(mapSaleOrderToClient) as Array<{ id?: unknown }>, existing)
    if (kept > 0) console.warn(`[documents-broadcast] kept ${kept} sale order(s) present in the store but missing from the table`)
    await saveStoreKeys({ deed_saleOrders: JSON.stringify(merged) })
  } catch (err) {
    console.error('[documents-broadcast] refreshSaleOrdersBlob failed:', err)
  }
}

export async function refreshQuotesBlob(): Promise<void> {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true, opportunity: true }, orderBy: { quoteDate: 'desc' } })
    const existing = (await loadAppState(['deed_quotes'])).deed_quotes
    const { merged, kept } = mergeInvoiceMirror(normalizeQuotesForClient(all) as Array<{ id?: unknown }>, existing)
    if (kept > 0) console.warn(`[documents-broadcast] kept ${kept} quote(s) present in the store but missing from the table`)
    await saveStoreKeys({ deed_quotes: JSON.stringify(merged) })
  } catch (err) {
    console.error('[documents-broadcast] refreshQuotesBlob failed:', err)
  }
}

/**
 * Invoices are read from the invoices table (lib/invoice-read-model.server.ts);
 * the deed_invoices screen copy is frozen. Nothing to rewrite — open tabs are
 * told to re-read.
 */
export async function refreshInvoicesBlob(): Promise<void> {
  await notifyStoreKeysChanged(['deed_invoices'])
}

/**
 * New documents show on the Finance list straight from the invoices table;
 * this only tells open tabs to re-read. Kept so callers need not change.
 */
export async function addInvoicesToList(_ids?: string[]): Promise<string[]> {
  await notifyStoreKeysChanged(['deed_invoices'])
  return []
}

/** Call after a Client/Contact (customer or vendor) update so their name/details
 * stop showing stale on every quote, sale order, and invoice that references them. */
export async function refreshDocumentBlobsForClientChange(): Promise<void> {
  await Promise.allSettled([
    refreshSaleOrdersBlob(),
    refreshQuotesBlob(),
    refreshInvoicesBlob(),
  ])
}
