import 'server-only'
import prisma from '@/lib/prisma'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { normalizeQuotesForClient } from '@/lib/quote-normalization'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'

// Sale orders, quotes (the CRM Quote entity), and invoices all embed a
// snapshot of the client/vendor's name in their `deed_*` blob cache
// (customerName / partnerName) rather than reading it live on every render —
// the same denormalize-then-broadcast pattern used throughout this app. That
// snapshot is only refreshed when the document itself is written, so editing
// a Client/Contact's name or details leaves every quote/invoice/sale order
// referencing them showing the old value until something unrelated happens
// to re-save that specific document. These three refresh the caches for all
// three document types after a client/vendor edit so the fix isn't "wait
// for someone to touch the SO again."

function mapSaleOrderToClient(order: any) {
  return {
    ...order,
    ref: order.orderNumber,
    quotationRef: order.quotationRef ?? undefined,
    proformaRef: order.proformaRef ?? undefined,
    pricelist: order.pricelist ?? undefined,
    pricelistId: order.pricelistId ?? undefined,
    currencyCode: order.currencyCode ?? 'KES',
    baseCurrencyCode: order.baseCurrencyCode ?? 'KES',
    exchangeRateToBase: Number(order.exchangeRateToBase ?? 1) || 1,
    salespersonId: order.salespersonId ?? undefined,
    salespersonName: order.salespersonName ?? undefined,
    salesTeam: order.salesTeam ?? undefined,
    sentMessage: order.sentMessage ?? undefined,
    customerId: order.clientId,
    customerName: order.client?.name ?? '',
    date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
    deliveryDate: order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : undefined,
    validUntil: order.validUntil ? new Date(order.validUntil).toISOString().slice(0, 10) : undefined,
    status: normalizeSaleStatus(order.status),
    sentAt: order.sentAt ? new Date(order.sentAt).toISOString() : undefined,
    confirmedAt: order.confirmedAt ? new Date(order.confirmedAt).toISOString() : undefined,
    total: Number(order.totalAmount ?? 0),
    taxTotal: Number(order.taxAmount ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    discountAmount: Number(order.discountAmount ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
    lockVersion: Number(order.lockVersion ?? 0),
    lines: (order.items ?? []).map((item: any) => ({
      id: item.id,
      productId: item.productId ?? '',
      productName: item.description ?? '',
      description: item.description ?? '',
      qty: Number(item.qty ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      taxRate: Number(item.taxRate ?? 0),
      subtotal: Number(item.lineTotal ?? 0),
      lineTotal: Number(item.lineTotal ?? 0),
      serialIds: item.serialNumberId ? [item.serialNumberId] : [],
      notes: item.notes ?? undefined,
      qtyDelivered: Number(item.qtyDelivered ?? 0),
      qtyInvoiced: Number(item.qtyInvoiced ?? 0),
    })),
  }
}

function mapDbInvoiceStatusToClient(status: string): string {
  if (status === 'approved') return 'posted'
  if (status === 'pending_approval') return 'draft'
  return status
}

function mapInvoiceToClient(invoice: any) {
  return {
    id: invoice.id,
    ref: invoice.invoiceNumber,
    type: invoice.client?.isVendor ? 'vendor_bill' as const : 'customer_invoice' as const,
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
