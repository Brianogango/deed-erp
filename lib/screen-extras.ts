import type { Prisma } from '@prisma/client'

/**
 * Fields a sale order, quote or purchase order carries on the screens that
 * the tables have no column for. They used to live only in the screen copies
 * (deed_saleOrders, deed_quotes, deed_purchaseOrders); with the copies frozen
 * they are kept in each row's screen_extras JSON column instead, so nothing
 * the screens rely on is lost.
 */

export const SALE_ORDER_EXTRA_KEYS = [
  'approvalStatus', 'approvalRequestIds', 'approvalRequiredReason',
  'stockReservationIds', 'creditOverrideApprovalId', 'discountApprovalId',
  'backorderApprovalId', 'backorderLines',
  'sentByName', 'acceptedByName', 'confirmedByName',
] as const

export const QUOTE_EXTRA_KEYS = [
  'contactPersonId', 'contactPersonName', 'contactPersonEmail', 'contactPersonPhone',
  'opportunityName', 'ownerId', 'ownerName', 'source', 'repairId', 'repairRef',
  'sentDate', 'viewedDate', 'acceptedDate', 'rejectedDate', 'rejectionReason',
  'viewCount', 'version', 'paymentTerms', 'deliveryTerms', 'warranty',
  'saleOrderId', 'invoiceId', 'convertedDate', 'parentQuoteId',
  'approvalStatus', 'approvalRequestIds', 'approvalRequiredReason',
] as const

export const PO_EXTRA_KEYS = [
  'receiptIds', 'billId', 'approvalStatus', 'approvalRequestIds',
  'repairId', 'repairRef', 'procurementRequestId',
] as const

export const PO_LINE_EXTRA_KEYS = ['importedSerials', 'specs'] as const

type Extras = Record<string, unknown>

const asObject = (v: unknown): Extras => (v && typeof v === 'object' && !Array.isArray(v) ? v as Extras : {})

/**
 * The extras after a write: keys the body sends replace the stored ones
 * (null or '' clears a key); keys it does not send are kept.
 */
export function mergeScreenExtras(stored: unknown, body: unknown, keys: readonly string[]): Prisma.InputJsonObject | null {
  const next: Extras = { ...asObject(stored) }
  const src = asObject(body)
  for (const key of keys) {
    if (!(key in src)) continue
    const value = src[key]
    if (value === undefined) continue
    if (value === null || value === '') delete next[key]
    else next[key] = value
  }
  return Object.keys(next).length ? next as Prisma.InputJsonObject : null
}

/** The stored extras for the screens (unknown keys ignored). */
export function readScreenExtras(stored: unknown, keys: readonly string[]): Extras {
  const src = asObject(stored)
  return Object.fromEntries(keys.filter(k => src[k] !== undefined && src[k] !== null).map(k => [k, src[k]]))
}
