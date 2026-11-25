// Pure helpers for the Sales module: money and date formatting, and the
// normaliser that turns a stored sale order into the shape the screens read.
//
// Split out of components/modules/Sales.tsx. Moved verbatim.

import type { SalesOrderView, SalesOrderLineView } from './types'
import { isQuotationStage, saleOrderLooksConfirmed } from '@/lib/odoo-sales-flow'

export const uid = () => crypto.randomUUID()
/** Prototype-matching currency label (KES …) — global fmtKes uses KSh. */
export const salesKes = (n: number | string | null | undefined) => {
  const v = typeof n === 'string' ? Number(n.replace(/,/g, '')) : Number(n ?? 0)
  const safe = Number.isFinite(v) ? v : 0
  return `KES ${safe.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
export const toDateStr = (value: unknown): string => {
  if (!value) return ''
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}
export const addDays = (value: string, days: number) => {
  const d = new Date(value)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function normalizeSalesOrderView(raw: any): SalesOrderView {
  const rawLines = Array.isArray(raw?.lines)
    ? raw.lines
    : Array.isArray(raw?.items)
      ? raw.items
      : []
  const lines: SalesOrderLineView[] = rawLines.map((line: any) => {
    const qty = num(line.qty)
    const unitPrice = num(line.unitPrice)
    const discount = num(line.discount ?? line.discountPercent)
    const taxRate = num(line.taxRate)
    const subtotal = num(line.subtotal ?? line.lineTotal, Math.round(qty * unitPrice * (1 - discount / 100)))
    const serialIds = Array.isArray(line.serialIds)
      ? line.serialIds
      : line.serialNumberId
        ? [line.serialNumberId]
        : []

    return {
      ...line,
      id: String(line.id ?? uid()),
      productId: line.productId ?? '',
      productName: line.productName ?? line.description ?? 'Item',
      description: line.description ?? line.productName ?? 'Item',
      qty,
      qtyDelivered: num(line.qtyDelivered),
      unitPrice,
      subtotal,
      taxRate,
      discount,
      discountPercent: num(line.discountPercent ?? discount),
      serialIds,
    }
  })
  const subtotal = num(raw?.subtotal, lines.reduce((sum, line) => sum + line.subtotal, 0))
  const taxTotal = num(raw?.taxTotal ?? raw?.taxAmount, lines.reduce((sum, line) => sum + Math.round(line.subtotal * (line.taxRate ?? 0) / 100), 0))
  const total = num(raw?.total ?? raw?.totalAmount, subtotal + taxTotal)

  const looksConfirmed = saleOrderLooksConfirmed({
    status: raw?.status,
    confirmedAt: raw?.confirmedAt,
    orderNumber: raw?.orderNumber ?? raw?.ref,
    ref: raw?.ref ?? raw?.orderNumber,
  })
  const status = looksConfirmed && isQuotationStage(raw?.status) ? 'sale' : raw?.status

  return {
    ...raw,
    status,
    ref: raw?.ref ?? raw?.orderNumber ?? raw?.id ?? '',
    customerId: raw?.customerId ?? raw?.clientId ?? '',
    customerName: raw?.customerName ?? raw?.client?.name ?? 'Customer',
    date: raw?.date ?? toDateStr(raw?.orderDate),
    deliveryDate: raw?.deliveryDate ? (toDateStr(raw.deliveryDate) || raw.deliveryDate) : raw?.deliveryDate,
    paymentTerms: raw?.paymentTerms,
    subtotal,
    taxTotal,
    total,
    lines,
  } as SalesOrderView
}
