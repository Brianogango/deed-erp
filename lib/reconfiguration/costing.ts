/**
 * Cost and selling-price calculators for device reconfiguration.
 * Pure functions — no DB.
 */

import { round2 } from '@/lib/inventory/valuation-math'
import type { PriceMethod } from './types'

export function calculateReconfigCost(params: {
  costBefore: number
  costRemoved: number
  costInstalled: number
  labourCost?: number
  otherCost?: number
  allowNegative?: boolean
}): {
  costAfter: number
  costRemoved: number
  costInstalled: number
  labourCost: number
  otherCost: number
  blocked: boolean
  reason?: string
} {
  const costBefore = Math.max(0, Number(params.costBefore) || 0)
  const costRemoved = Math.max(0, Number(params.costRemoved) || 0)
  const costInstalled = Math.max(0, Number(params.costInstalled) || 0)
  const labourCost = Math.max(0, Number(params.labourCost) || 0)
  const otherCost = Math.max(0, Number(params.otherCost) || 0)
  const costAfter = round2(costBefore - costRemoved + costInstalled + labourCost + otherCost)

  if (costAfter < 0 && !params.allowNegative) {
    return {
      costAfter,
      costRemoved,
      costInstalled,
      labourCost,
      otherCost,
      blocked: true,
      reason: 'Reconfiguration would produce a negative device cost. Finance override required.',
    }
  }

  return {
    costAfter: Math.max(0, costAfter),
    costRemoved,
    costInstalled,
    labourCost,
    otherCost,
    blocked: false,
  }
}

export function calculateRecommendedSellingPrice(params: {
  method: PriceMethod
  costAfter: number
  sellingPriceBefore?: number | null
  pricelistPrice?: number | null
  markupPct?: number | null
  fixedDifference?: number | null
  customerPrice?: number | null
  promotionPrice?: number | null
  manualPrice?: number | null
}): { recommended: number; method: PriceMethod } {
  const method = params.method
  let recommended = 0

  switch (method) {
    case 'manual':
      recommended = Number(params.manualPrice) || 0
      break
    case 'pricelist':
      recommended = Number(params.pricelistPrice) || 0
      break
    case 'cost_plus': {
      const pct = Number(params.markupPct) || 0
      recommended = round2((Number(params.costAfter) || 0) * (1 + pct / 100))
      break
    }
    case 'fixed_diff': {
      const before = Number(params.sellingPriceBefore) || 0
      const diff = Number(params.fixedDifference) || 0
      recommended = round2(before + diff)
      break
    }
    case 'customer':
      recommended = Number(params.customerPrice) || 0
      break
    case 'promotion':
      recommended = Number(params.promotionPrice) || 0
      break
    default:
      recommended = Number(params.manualPrice) || Number(params.sellingPriceBefore) || 0
  }

  return { recommended: Math.max(0, round2(recommended)), method }
}

export function calculateMargin(params: {
  sellingPrice: number
  costAfter: number
}): { grossMargin: number; grossMarginPct: number } {
  const selling = Number(params.sellingPrice) || 0
  const cost = Number(params.costAfter) || 0
  const grossMargin = round2(selling - cost)
  const grossMarginPct = selling > 0 ? round2((grossMargin / selling) * 100) : 0
  return { grossMargin, grossMarginPct }
}

export function isBelowMinimumMargin(params: {
  grossMarginPct: number
  minMarginPct: number
}): boolean {
  const min = Number(params.minMarginPct) || 0
  return params.grossMarginPct + 1e-9 < min
}

/** Customer-paid upgrade commercial charge (not inventory valuation). */
export function calculateUpgradeCharge(params: {
  installedComponentsSellingPrice: number
  labourCharge: number
  otherServiceCharges?: number
  approvedTradeInValue?: number
}): number {
  return round2(
    Math.max(0, Number(params.installedComponentsSellingPrice) || 0) +
      Math.max(0, Number(params.labourCharge) || 0) +
      Math.max(0, Number(params.otherServiceCharges) || 0) -
      Math.max(0, Number(params.approvedTradeInValue) || 0),
  )
}

export function reconfigValuationEventKey(ref: string) {
  return `VAL/RCF/${String(ref || '').trim() || 'noref'}`.slice(0, 120)
}

export function reconfigCompletionEventKey(workOrderId: string) {
  return `RCF-COMPLETE:${String(workOrderId || '').trim()}`.slice(0, 120)
}

export function reconfigValuationJournalRef(ref: string) {
  return `JRN/STK/RCF/${String(ref || '').trim() || 'noref'}`.slice(0, 80)
}
