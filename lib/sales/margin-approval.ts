/**
 * Margin / floor-price / discount approval triggers for Sale Orders.
 * Reuses existing ApprovalType ladders (discount + special_pricing).
 */

import type { ApprovalType } from '@/lib/sales-flow-types'
import { requiresApproval } from '@/lib/sales-approvals'
import { needsSpecialPricingApproval, type PricelistProductPrices, type ResolveListPriceResult } from '@/lib/pricing/pricelist'

export interface MarginApprovalLine {
  productId?: string
  productName?: string
  qty?: number
  unitPrice?: number
  discount?: number
  discountPercent?: number
  lineType?: string
  subtotal?: number
}

export interface MarginApprovalProduct extends PricelistProductPrices {
  id: string
  name?: string
  costPrice?: number | null
  unit?: string | null
  trackStock?: boolean | null
}

export interface SaleOrderApprovalTrigger {
  type: ApprovalType
  details: Record<string, unknown>
  reason: string
}

export function lineGrossMarginPercent(opts: {
  unitPrice: number
  costPrice: number
  discountPercent?: number
}): number | null {
  const unit = Number(opts.unitPrice) || 0
  const cost = Number(opts.costPrice) || 0
  const disc = Math.max(0, Math.min(100, Number(opts.discountPercent) || 0))
  const net = unit * (1 - disc / 100)
  if (net <= 0) return null
  return ((net - cost) / net) * 100
}

/**
 * Compute approval triggers for a quotation / SO before send or confirm.
 * Floor price = product cost. Margin uses settings.salesMinMarginPercent
 * (falls back to reconfigurationMinMarginPct / 10).
 */
export function computeSaleOrderApprovalTriggers(opts: {
  lines: readonly MarginApprovalLine[]
  products: readonly MarginApprovalProduct[]
  headerDiscountAmount?: number
  orderTotal?: number
  minMarginPercent?: number
  /** Effective list price per product (from resolveListPrice). */
  listPriceByProductId?: Record<string, number>
  creditRequested?: number
  creditAvailable?: number
  backorderQty?: number
}): SaleOrderApprovalTrigger[] {
  const triggers: SaleOrderApprovalTrigger[] = []
  const lines = (opts.lines ?? []).filter(l => l.lineType !== 'section')
  const minMargin = Number.isFinite(Number(opts.minMarginPercent))
    ? Number(opts.minMarginPercent)
    : 10

  let maxDiscount = 0
  let belowCost = false
  let belowMargin = false
  let belowPricelist = false
  let worstMargin: number | null = null
  const offenders: string[] = []

  for (const line of lines) {
    const disc = Math.max(0, Number(line.discount ?? line.discountPercent) || 0)
    maxDiscount = Math.max(maxDiscount, disc)

    const product = opts.products.find(p => p.id === line.productId)
    if (!product) continue
    const unit = String(product.unit ?? '').toLowerCase()
    if (unit === 'service' || product.trackStock === false) continue

    const unitPrice = Number(line.unitPrice) || 0
    const cost = Number(product.costPrice) || 0
    const netUnit = unitPrice * (1 - disc / 100)

    if (cost > 0 && netUnit + 0.0001 < cost) {
      belowCost = true
      offenders.push(line.productName || product.name || product.id)
    }

    const margin = lineGrossMarginPercent({
      unitPrice,
      costPrice: cost,
      discountPercent: disc,
    })
    if (margin != null && cost > 0 && margin < minMargin) {
      belowMargin = true
      worstMargin = worstMargin == null ? margin : Math.min(worstMargin, margin)
      offenders.push(line.productName || product.name || product.id)
    }

    const listPrice = opts.listPriceByProductId?.[product.id]
    if (listPrice != null && listPrice > 0) {
      const resolved: ResolveListPriceResult = {
        listPrice,
        unitPrice: netUnit,
        pricelistCode: 'CUSTOM',
        priceSource: 'fixed',
        currencyCode: 'KES',
        belowList: netUnit < listPrice - 0.005,
        discountFromListPercent:
          Math.round(((listPrice - netUnit) / listPrice) * 10000) / 100,
        usedItemOverride: false,
      }
      if (needsSpecialPricingApproval(resolved, disc)) {
        belowPricelist = true
      }
    }
  }

  // Header discount as an order-level discount percent against line subtotals.
  const lineSubtotal = lines.reduce((s, l) => s + (Number(l.subtotal) || ((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))), 0)
  const headerDisc = Math.max(0, Number(opts.headerDiscountAmount) || 0)
  if (lineSubtotal > 0 && headerDisc > 0) {
    maxDiscount = Math.max(maxDiscount, (headerDisc / lineSubtotal) * 100)
  }

  if (maxDiscount > 0) {
    const details = {
      discountPercent: Math.round(maxDiscount * 100) / 100,
      discountAmount: headerDisc,
    }
    if (requiresApproval('discount', details)) {
      triggers.push({
        type: 'discount',
        details,
        reason: `Discount ${details.discountPercent}% requires approval`,
      })
    }
  }

  if (belowCost || belowMargin || belowPricelist) {
    const details = {
      value: Number(opts.orderTotal) || 0,
      belowCost,
      belowMargin,
      belowPricelist,
      minMarginPercent: minMargin,
      worstMargin: worstMargin == null ? undefined : Math.round(worstMargin * 100) / 100,
      products: [...new Set(offenders)].slice(0, 8),
    }
    if (requiresApproval('special_pricing', details)) {
      const bits = [
        belowCost ? 'below cost (floor)' : null,
        belowMargin ? `margin below ${minMargin}%` : null,
        belowPricelist ? 'below pricelist' : null,
      ].filter(Boolean)
      triggers.push({
        type: 'special_pricing',
        details,
        reason: `Special pricing: ${bits.join(', ')}`,
      })
    }
  }

  const creditRequested = Number(opts.creditRequested)
  const creditAvailable = Number(opts.creditAvailable)
  if (Number.isFinite(creditRequested) && Number.isFinite(creditAvailable) && creditRequested > creditAvailable) {
    const details = { creditRequested, creditAvailable }
    if (requiresApproval('credit_override', details)) {
      triggers.push({
        type: 'credit_override',
        details,
        reason: 'Customer exceeds available credit',
      })
    }
  }

  const backorderQty = Math.max(0, Number(opts.backorderQty) || 0)
  if (backorderQty > 0) {
    const details = { backorderQty }
    if (requiresApproval('backorder', details)) {
      triggers.push({
        type: 'backorder',
        details,
        reason: `Backorder of ${backorderQty} unit(s) requires approval`,
      })
    }
  }

  return triggers
}
