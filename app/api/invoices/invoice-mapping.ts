import { optionalUuid } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'

export const INVOICE_STATUS_MAP: Record<string, string> = {
  posted: 'approved',
  partial: 'partially_paid',
  pending: 'pending_approval',
  sent: 'pending_approval',
  open: 'approved',
  overdue: 'approved',
  void: 'voided',
}

const VALID_STATUSES = new Set([
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'invoiced',
  'dispatched',
  'delivered',
  'paid',
  'partially_paid',
  'cancelled',
  'voided',
])

function asNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function asDate(value: unknown) {
  if (!value) return undefined
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function mapInvoiceStatus(status: unknown, fallback?: string) {
  if (typeof status !== 'string' || status.trim() === '') return fallback
  const mapped = INVOICE_STATUS_MAP[status] ?? status
  return VALID_STATUSES.has(mapped) ? mapped : fallback
}

export function resolveInvoiceNumber(body: any, fallback: string) {
  const candidate = String(body.invoiceNumber ?? body.ref ?? '').trim()
  return candidate && !isUUID(candidate) ? candidate : fallback
}

export function mapInvoiceBodyToDb(body: any, clientId: string) {
  const rawLines: any[] = body.lines ?? body.items ?? []
  const lines = mapInvoiceItems(rawLines)
  const subtotal = body.subtotal !== undefined
    ? asNumber(body.subtotal)
    : lines.reduce((sum, line) => sum + line.lineSubtotal, 0)
  const taxAmount = body.taxAmount !== undefined || body.taxTotal !== undefined
    ? asNumber(body.taxAmount ?? body.taxTotal)
    : lines.reduce((sum, line) => sum + line.lineTax, 0)
  const totalAmount = body.totalAmount !== undefined || body.total !== undefined
    ? asNumber(body.totalAmount ?? body.total)
    : subtotal - asNumber(body.discountAmount) + taxAmount

  return {
    clientId,
    saleOrderId: optionalUuid(body.saleOrderId) ?? null,
    repairId: optionalUuid(body.repairId) ?? null,
    quoteId: optionalUuid(body.quoteId) ?? null,
    status: mapInvoiceStatus(body.status, 'draft'),
    invoiceDate: asDate(body.invoiceDate ?? body.date),
    dueDate: asDate(body.dueDate),
    subject: body.subject ?? null,
    subtotal,
    taxAmount,
    discountAmount: asNumber(body.discountAmount),
    totalAmount,
    amountPaid: asNumber(body.amountPaid),
    notes: body.notes ?? null,
  }
}

export function mapInvoiceUpdateToDb(body: any, clientId?: string) {
  const data: Record<string, any> = {
    clientId,
    saleOrderId: body.saleOrderId !== undefined ? optionalUuid(body.saleOrderId) ?? null : undefined,
    repairId: body.repairId !== undefined ? optionalUuid(body.repairId) ?? null : undefined,
    quoteId: body.quoteId !== undefined ? optionalUuid(body.quoteId) ?? null : undefined,
    subject: body.subject ?? undefined,
    subtotal: body.subtotal !== undefined ? asNumber(body.subtotal) : undefined,
    taxAmount: body.taxAmount !== undefined || body.taxTotal !== undefined
      ? asNumber(body.taxAmount ?? body.taxTotal)
      : undefined,
    discountAmount: body.discountAmount !== undefined ? asNumber(body.discountAmount) : undefined,
    totalAmount: body.totalAmount !== undefined || body.total !== undefined
      ? asNumber(body.totalAmount ?? body.total)
      : undefined,
    amountPaid: body.amountPaid !== undefined ? asNumber(body.amountPaid) : undefined,
    notes: body.notes ?? undefined,
    dueDate: body.dueDate !== undefined ? asDate(body.dueDate) : undefined,
    invoiceDate: body.invoiceDate !== undefined || body.date !== undefined ? asDate(body.invoiceDate ?? body.date) : undefined,
    status: mapInvoiceStatus(body.status),
  }
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k])
  return data
}

export function mapInvoiceItems(lines: any[]) {
  return lines.map((line: any, index: number) => {
    const qty = Math.max(1, Math.trunc(asNumber(line.qty, 1)))
    const unitPrice = asNumber(line.unitPrice ?? line.price)
    const taxRate = asNumber(line.taxRate ?? line.tax)
    const lineSubtotal = line.lineSubtotal !== undefined || line.subtotal !== undefined
      ? asNumber(line.lineSubtotal ?? line.subtotal)
      : qty * unitPrice
    const lineTax = line.lineTax !== undefined || line.taxAmount !== undefined
      ? asNumber(line.lineTax ?? line.taxAmount)
      : Math.round(lineSubtotal * taxRate / 100)
    const lineTotal = line.lineTotal !== undefined
      ? asNumber(line.lineTotal)
      : lineSubtotal + lineTax

    return {
      description: line.description ?? line.desc ?? '',
      qty,
      unitPrice,
      taxRate,
      lineSubtotal,
      lineTax,
      lineTotal,
      sortOrder: asNumber(line.sortOrder, index),
      ...(optionalUuid(line.productId) ? { productId: optionalUuid(line.productId) } : {}),
      ...(optionalUuid(line.serialNumberId) ? { serialNumberId: optionalUuid(line.serialNumberId) } : {}),
    }
  })
}
