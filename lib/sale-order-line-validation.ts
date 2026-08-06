/**
 * Server-side commercial line guards for sale-order create/update.
 * Rejects negative qty/price and out-of-range discounts that the client UI
 * normally prevents but a crafted API call could otherwise write.
 */

export type SaleOrderLineValidationInput = {
  lineType?: unknown
  qty?: unknown
  unitPrice?: unknown
  discount?: unknown
  discountPercent?: unknown
  productName?: unknown
  description?: unknown
}

export function validateSaleOrderLines(
  lines: SaleOrderLineValidationInput[] | null | undefined,
): string | null {
  if (!Array.isArray(lines)) return null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.lineType === 'section') continue

    const label = String(line.productName ?? line.description ?? `line ${i + 1}`).trim() || `line ${i + 1}`
    const qty = Number(line.qty)
    const unitPrice = Number(line.unitPrice)
    const discount = Number(line.discount ?? line.discountPercent ?? 0)

    if (!Number.isFinite(qty) || qty <= 0) {
      return `Quantity must be greater than zero (${label})`
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return `Unit price cannot be negative (${label})`
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      return `Discount must be between 0 and 100 (${label})`
    }
  }

  return null
}
