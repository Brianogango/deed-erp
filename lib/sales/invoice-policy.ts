/**
 * Resolve the invoicing policy for a sale-order line.
 *
 * Deed's operational sales flow is delivery-first for physical stock:
 * confirmed SO -> delivery -> validate -> invoice.  A legacy/catalog
 * `ordered quantities` setting must therefore never make stockable hardware
 * invoiceable before it has actually been delivered.  Services and other
 * non-stock lines can still bill on ordered quantity, including when their
 * explicit line/product policy says `order`.
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
  const nonStockLine = isNonStockSaleLine(
    {
      productId: productId || (hasCatalogHint ? '__catalog__' : ''),
      unit: opts.lineUnit ?? opts.productUnit,
      lineType: opts.lineType,
    },
    hasCatalogHint ? catalog : undefined,
  ) || (hasCatalogHint && isNonStockProduct(catalog))

  // Explicit policies are respected only where they cannot bypass physical
  // fulfilment. A stockable item is always invoiced from delivered quantity.
  const explicit = normalizePolicy(opts.linePolicy) ?? normalizePolicy(opts.productPolicy)
  if (explicit === 'delivery') return 'delivery'
  if (explicit === 'order' && nonStockLine) return 'order'

  // Unlinked commercial/service-style lines cannot be picked in warehouse.
  if (!productId && !hasCatalogHint) return 'order'
  if (nonStockLine) return 'order'

  return 'delivery'
}

function normalizePolicy(raw: unknown): InvoicePolicy | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'order' || value === 'ordered' || value === 'ordered_quantities') return 'order'
  if (value === 'delivery' || value === 'delivered' || value === 'delivered_quantities') return 'delivery'
  return null
}
