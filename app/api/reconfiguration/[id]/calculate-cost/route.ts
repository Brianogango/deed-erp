import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import {
  calculateMargin,
  calculateRecommendedSellingPrice,
  calculateReconfigCost,
} from '@/lib/reconfiguration/costing'
import { getWorkOrder } from '@/lib/reconfiguration/service'
import type { PriceMethod } from '@/lib/reconfiguration/types'
import prisma from '@/lib/prisma'
import { resolveCostPlusListPrice } from '@/lib/pricing/apply-margin-sale-price'
import { loadServerMarginPolicy } from '@/lib/pricing/sync-product-list-from-cost.server'

/**
 * POST /api/reconfiguration/[id]/calculate-cost
 * Recompute cost / recommended price / margin from work-order lines.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requirePermission('viewReconfigComponentCosts')

    // Optional body overrides (labour/other/price method) without mutating the WO
    let overrides: {
      labourCost?: number
      otherCost?: number
      priceMethod?: PriceMethod
      markupPct?: number
      fixedDifference?: number
      finalSellingPrice?: number
    } = {}
    try {
      const body = await request.json()
      if (body && typeof body === 'object') {
        overrides = body
      }
    } catch {
      // empty body is fine
    }

    const wo = await getWorkOrder(params.id)
    const costRemoved = (wo.removalLines ?? []).reduce(
      (sum, line) => sum + Number(line.existingCost ?? 0),
      0,
    )
    const costInstalled = (wo.installationLines ?? []).reduce(
      (sum, line) => sum + Number(line.unitCost ?? 0) * Number(line.quantity ?? 1),
      0,
    )

    const cost = calculateReconfigCost({
      costBefore: Number(wo.costBefore ?? 0),
      costRemoved,
      costInstalled,
      labourCost: overrides.labourCost ?? Number(wo.labourCost ?? 0),
      otherCost: overrides.otherCost ?? Number(wo.otherCost ?? 0),
    })

    const method = (overrides.priceMethod || wo.priceMethod || 'cost_plus') as PriceMethod
    let price = calculateRecommendedSellingPrice({
      method,
      costAfter: cost.costAfter,
      sellingPriceBefore: wo.sellingPriceBefore != null ? Number(wo.sellingPriceBefore) : null,
      markupPct: overrides.markupPct ?? 25,
      fixedDifference: overrides.fixedDifference,
      manualPrice:
        overrides.finalSellingPrice ??
        (wo.finalSellingPrice != null ? Number(wo.finalSellingPrice) : null),
    })

    // Prefer margin-policy list for cost_plus when caller did not force markupPct.
    if (method === 'cost_plus' && overrides.markupPct == null) {
      const { policy, legacyMarkupMap } = await loadServerMarginPolicy()
      const host = await prisma.product.findUnique({
        where: { id: wo.productId },
        select: {
          productType: true,
          specs: true,
          category: { select: { name: true } },
        },
      })
      const specs = host?.specs && typeof host.specs === 'object' ? (host.specs as Record<string, unknown>) : {}
      price = {
        recommended: resolveCostPlusListPrice({
          costPrice: cost.costAfter,
          erpCategory: host?.category?.name,
          pricingCategoryId: typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null,
          productType: host?.productType,
          productKind: typeof specs.productKind === 'string' ? specs.productKind : null,
          unit: typeof specs.unit === 'string' ? specs.unit : null,
          policy,
          legacyMarkupMap,
          fallbackMarkupPct: 25,
        }),
        method: 'cost_plus',
      }
    }

    const selling =
      overrides.finalSellingPrice ??
      (wo.finalSellingPrice != null ? Number(wo.finalSellingPrice) : price.recommended)
    const margin = calculateMargin({ sellingPrice: selling, costAfter: cost.costAfter })

    return NextResponse.json({
      costBefore: Number(wo.costBefore ?? 0),
      costRemoved,
      costInstalled,
      cost,
      price,
      margin,
      sellingPrice: selling,
    })
  })
}
