import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { mergeInvoiceMirror } from '@/lib/invoice-mirror-merge'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'

function mapDbInvoiceStatusToClient(status: string): string {
  // Posted documents; whether they are paid comes from amountPaid. Leaving
  // 'paid' / 'invoiced' as the status took them out of the store-write guards.
  if (status === 'approved' || status === 'invoiced' || status === 'paid' || status === 'partially_paid') return 'posted'
  if (status === 'pending_approval') return 'draft'
  return status
}

function mapInvoiceToClient(invoice: any) {
  return {
    id: invoice.id,
    ref: invoice.invoiceNumber,
    // The document says which way it runs, not the contact: a customer who is
    // also a supplier must not have their invoices filed under Bills.
    type: invoiceDocumentType(invoice),
    status: mapDbInvoiceStatusToClient(String(invoice.status)),
    partnerId: invoice.clientId,
    partnerName: invoice.client?.name ?? '',
    date: invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString().slice(0, 10) : '',
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '',
    lines: mapDbInvoiceItemsToClientLines(invoice.items),
    subtotal: Number(invoice.subtotal ?? 0),
    taxTotal: Number(invoice.taxAmount ?? 0),
    total: Number(invoice.totalAmount ?? 0),
    amountPaid: Number(invoice.amountPaid ?? 0),
    saleOrderId: invoice.saleOrderId ?? undefined,
    repairId: invoice.repairId ?? undefined,
    notes: invoice.notes ?? '',
    invoiceAddress: invoice.invoiceAddress ?? undefined,
    deliveryAddress: invoice.deliveryAddress ?? undefined,
    currencyCode: invoice.currencyCode ?? 'KES',
    baseCurrencyCode: invoice.baseCurrencyCode ?? 'KES',
    exchangeRateToBase: Number(invoice.exchangeRateToBase ?? 1) || 1,
    paymentBlocked: Boolean(invoice.paymentBlocked),
    lockVersion: Number(invoice.lockVersion ?? 0),
  }
}

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

export async function refreshInvoicesBlob(): Promise<void> {
  try {
    const all = await prisma.invoice.findMany({ include: { client: true, items: true }, orderBy: { invoiceDate: 'desc' } })
    // Never replace the list outright: a document that only the store list
    // knows about (its table save failed) must survive the refresh.
    const existing = (await loadAppState(['deed_invoices'])).deed_invoices
    const { merged, kept } = mergeInvoiceMirror(all.map(mapInvoiceToClient), existing)
    if (kept > 0) console.warn(`[documents-broadcast] kept ${kept} invoice(s) present in the store but missing from the invoices table`)
    await saveStoreKeys({ deed_invoices: JSON.stringify(merged) })
  } catch (err) {
    console.error('[documents-broadcast] refreshInvoicesBlob failed:', err)
  }
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
