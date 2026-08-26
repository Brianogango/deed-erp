/**
 * Resolve Odoo-style invoicing policy for a sale-order line.
 * Product setting wins; missing product defaults to delivered quantities
 * for stockable goods (safer for hardware) and ordered for services.
 */

import type { InvoicePolicy } from '@/lib/odoo-sales-flow'
import { isNonStockProduct, isNonStockSaleLine } from '@/lib/sales/non-stock-line'

export function resolveInvoicePolicy(opts: {
  linePolicy?: unknown
  productPolicy?: unknown
  productUnit?: unknown
  productKind?: unknown
  productCategory?: unknown
  trackingMethod?: unknown
  productId?: unknown
  lineType?: unknown
  lineUnit?: unknown
  /** Prisma Product.trackStock — false means service / non-stockable. */
  trackStock?: unknown
}): InvoicePolicy {
  const fromLine = normalizePolicy(opts.linePolicy)
  if (fromLine) return fromLine
  const fromProduct = normalizePolicy(opts.productPolicy)
  if (fromProduct) return fromProduct

  const catalog = {
    unit: opts.productUnit,
    productKind: opts.productKind,
    category: opts.productCategory,
    trackStock: opts.trackStock,
    trackingMethod: opts.trackingMethod,
  }
  const hasCatalogHint =
    opts.productUnit != null
    || opts.productKind != null
    || opts.productCategory != null
    || opts.trackStock !== undefined
    || opts.trackingMethod != null

  const productId = String(opts.productId ?? '').trim()
  // Unlinked commercial line with no catalog product: cannot pick, bill ordered qty.
  if (!productId && !hasCatalogHint) return 'order'

  if (isNonStockSaleLine(
    {
      productId: productId || (hasCatalogHint ? '__catalog__' : ''),
      unit: opts.lineUnit ?? opts.productUnit,
      lineType: opts.lineType,
    },
    hasCatalogHint ? catalog : undefined,
  )) return 'order'

  if (hasCatalogHint && isNonStockProduct(catalog)) return 'order'

  return 'delivery'
}

function normalizePolicy(raw: unknown): InvoicePolicy | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'order' || value === 'ordered' || value === 'ordered_quantities') return 'order'
  if (value === 'delivery' || value === 'delivered' || value === 'delivered_quantities') return 'delivery'
  return null
}
