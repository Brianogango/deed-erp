import 'server-only'
import { notifyStoreKeysChanged } from '@/lib/server-store'

/**
 * Sale orders and quotes are read from their tables
 * (lib/sales-read-model.server.ts); their screen copies are frozen. Nothing to
 * rewrite — open tabs are told to re-read.
 */
export async function refreshSaleOrdersBlob(): Promise<void> {
  await notifyStoreKeysChanged(['deed_saleOrders'])
}

export async function refreshQuotesBlob(): Promise<void> {
  await notifyStoreKeysChanged(['deed_quotes'])
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
