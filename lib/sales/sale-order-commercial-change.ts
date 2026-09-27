import { isSaleOrderSectionLine } from '@/lib/sale-order-items-write'

/**
 * Does this PATCH body change the commercial terms of the order?
 *
 * This is the whole of the commercial freeze. A sent quotation, an accepted
 * quotation and a confirmed sale order are all frozen by asking this question
 * and refusing with 409 when the answer is yes, so anything it fails to notice
 * is a term that can be rewritten on a frozen order by anyone, with no approval
 * and no audit entry — and anything it reports falsely freezes edits that the
 * workflow allows.
 *
 * It lived inside the PATCH route as a private function, where it could not be
 * tested, and it had one bug of each kind. Both are described at their fix.
 */

export function normalizeOptionalProducts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).map((item: any) => ({
    id: String(item?.id ?? '').slice(0, 120),
    productId: String(item?.productId ?? '').slice(0, 120),
    productName: String(item?.productName ?? '').slice(0, 300),
    qty: Math.max(0, Number(item?.qty) || 0),
    unitPrice: Math.max(0, Number(item?.unitPrice) || 0),
  })).filter(item => item.productName && item.qty > 0)
}

/**
 * The per-line discount, read from whichever shape the line arrived in.
 *
 * Prisma rows carry `discountPct`. Client lines carry `discount` and
 * `discountPercent` (mapSaleOrderToClient writes both). The two sides of the
 * comparison are therefore in different shapes, and a key reading only one name
 * would report a change on every PATCH of a discounted order.
 */
function lineDiscount(line: any) {
  return Number(line.discountPct ?? line.discount ?? line.discountPercent ?? 0) || 0
}

/** Commercial content of a line for freeze comparison (fulfilment qty ignored). */
export function commercialLineKey(line: any) {
  return [
    line.productId ?? '',
    line.description ?? line.productName ?? '',
    Number(line.qty ?? 0),
    Number(line.unitPrice ?? 0),
    Number(line.taxRate ?? 0),
    // The discount was missing here. It is a priced term of the deal and it was
    // the only priced term the key omitted, so a PATCH that lowered `discount`
    // while re-sending the stored `lineTotal` produced an identical key and went
    // through the freeze untouched — re-pricing a confirmed sale silently.
    lineDiscount(line),
    Number(line.lineTotal ?? line.subtotal ?? 0),
  ].join('|')
}

/** Commercial lines only: section headings carry no terms and are not compared. */
function commercialKeys(lines: unknown) {
  if (!Array.isArray(lines)) return []
  return lines
    .filter((line: any) => !isSaleOrderSectionLine(line))
    .map(commercialLineKey)
    .sort()
}

export function hasCommercialChange(existing: any, body: any): boolean {
  const changedScalar = (
    (body.clientId !== undefined || body.customerId !== undefined) &&
      String(body.clientId ?? body.customerId ?? '') !== String(existing.clientId ?? '')
  ) || (
    (body.subtotal !== undefined) && Number(body.subtotal) !== Number(existing.subtotal)
  ) || (
    (body.totalAmount !== undefined || body.total !== undefined) &&
      Number(body.totalAmount ?? body.total) !== Number(existing.totalAmount)
  ) || (
    (body.taxAmount !== undefined || body.taxTotal !== undefined) &&
      Number(body.taxAmount ?? body.taxTotal) !== Number(existing.taxAmount)
  ) || (
    body.discountAmount !== undefined && Number(body.discountAmount) !== Number(existing.discountAmount)
  ) || (
    body.termsAndConditions !== undefined &&
      String(body.termsAndConditions ?? '') !== String(existing.termsAndConditions ?? '')
  ) || (
    body.optionalProducts !== undefined &&
      JSON.stringify(normalizeOptionalProducts(body.optionalProducts)) !== JSON.stringify(existing.optionalProducts ?? [])
  )
  if (changedScalar) return true

  const rawItems = Array.isArray(body.lines) ? body.lines : body.items
  // A body that submits no lines at all is not asking to change them.
  if (!Array.isArray(rawItems)) return false

  // Sections are filtered from BOTH sides. They were filtered from the request
  // only, and a persisted section carries no `lineType` — it is a qty=0 unpriced
  // row — so for any order containing a section heading the two arrays could
  // never be the same length, every PATCH reported a commercial change, and on a
  // confirmed order that froze edits the workflow permits.
  const requested = commercialKeys(rawItems)
  const current = commercialKeys(existing.items ?? [])
  return requested.length !== current.length
    || requested.some((key: string, i: number) => key !== current[i])
}
