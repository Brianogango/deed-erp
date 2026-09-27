import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { serializeQuotationPaymentTerms } from '@/lib/sales/quotation-defaults'
import { orderedSaleOrderItems } from '@/lib/sales/sale-order-line-order'

/**
 * The one shape a sale order takes on the client.
 *
 * This existed as five divergent hand-written copies — two API route
 * definitions, one in documents-broadcast, one in new-version, and two more
 * inlined in create-invoice and deliver-lines — and each copy dropped
 * different fields. That is not a tidiness problem: two of those copies write
 * the whole deed_saleOrders blob, so whichever fields they omit are erased
 * from every order on the next Create Invoice or delivery validation.
 *
 * Per-line `discount` was the expensive one. Losing it does not merely hide a
 * number: the next save of that order recomputes its header from lines that
 * now claim no discount, so a 20%-discounted order silently re-prices upward
 * with no user edit behind it. The line-ordering fix had to be applied in six
 * places for the same reason.
 *
 * Callers pass a Prisma SaleOrder with `items` and `client` included.
 */
export function mapSaleOrderToClient(order: any) {
  // Never leave raw Prisma `items` on the client row — PATCH used to prefer
  // that stale array over edited `lines` and resurrect deleted products.
  const { items: _prismaItems, client: _client, ...orderRest } = order ?? {}
  return {
    ...orderRest,
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
    // paymentTermsDays is the durable column; the client historically reads a
    // display string. Reconstruct it so the value survives a server round-trip
    // instead of silently disappearing (it was never persisted before).
    paymentTerms: order.paymentTermsDays != null
      ? serializeQuotationPaymentTerms(Number(order.paymentTermsDays))
      : undefined,
    customerId: order.clientId,
    customerName: order.client?.name ?? '',
    date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
    deliveryDate: order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : undefined,
    validUntil: order.validUntil ? new Date(order.validUntil).toISOString().slice(0, 10) : undefined,
    status: normalizeSaleStatus(order.status),
    sentAt: order.sentAt ? new Date(order.sentAt).toISOString() : undefined,
    acceptedAt: order.acceptedAt ? new Date(order.acceptedAt).toISOString() : undefined,
    acceptedById: order.acceptedById ?? undefined,
    confirmedAt: order.confirmedAt ? new Date(order.confirmedAt).toISOString() : undefined,
    total: Number(order.totalAmount ?? 0),
    taxTotal: Number(order.taxAmount ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    discountAmount: Number(order.discountAmount ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
    lockVersion: Number(order.lockVersion ?? 0),
    lines: orderedSaleOrderItems(order.items).map((item: any) => {
      const qty = Number(item.qty ?? 0)
      const productId = item.productId ?? ''
      // Section headings were historically persisted as qty=0 rows without lineType.
      const lineType = qty === 0 && !productId && !(Number(item.unitPrice ?? 0) > 0) ? 'section' as const : undefined
      return {
        id: item.id,
        productId,
        productName: item.description ?? '',
        description: item.description ?? '',
        qty,
        unitPrice: Number(item.unitPrice ?? 0),
        taxRate: Number(item.taxRate ?? 0),
        // discount/discountPercent both round-trip so a reopened line's edit
        // form shows the original discount instead of resetting to 0 — before
        // discountPct existed on the DB row, this was unrecoverable and saving
        // an untouched line silently erased its discount.
        discount: Number(item.discountPct ?? 0),
        discountPercent: Number(item.discountPct ?? 0),
        subtotal: Number(item.lineTotal ?? 0),
        lineTotal: Number(item.lineTotal ?? 0),
        serialIds: item.serialNumberId ? [item.serialNumberId] : [],
        notes: item.notes ?? undefined,
        qtyDelivered: Number(item.qtyDelivered ?? 0),
        qtyInvoiced: Number(item.qtyInvoiced ?? 0),
        ...(lineType ? { lineType } : {}),
      }
    }),
  }
}
