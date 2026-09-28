import 'server-only'
import prisma from '@/lib/prisma'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'
import { invoiceDocumentType } from '@/lib/accounting/invoice-document-type'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'

function mapDbInvoiceStatusToClient(status: string): string {
  if (status === 'approved') return 'posted'
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
    await saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch (err) {
    console.error('[documents-broadcast] refreshSaleOrdersBlob failed:', err)
  }
}

export async function refreshQuotesBlob(): Promise<void> {
  try {
    const all = await prisma.quote.findMany({ include: { items: true, client: true, opportunity: true }, orderBy: { quoteDate: 'desc' } })
    await saveStoreKeys({ deed_quotes: JSON.stringify(normalizeQuotesForClient(all)) })
  } catch (err) {
    console.error('[documents-broadcast] refreshQuotesBlob failed:', err)
  }
}

export async function refreshInvoicesBlob(): Promise<void> {
  try {
    const all = await prisma.invoice.findMany({ include: { client: true, items: true }, orderBy: { invoiceDate: 'desc' } })
    await saveStoreKeys({ deed_invoices: JSON.stringify(all.map(mapInvoiceToClient)) })
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
