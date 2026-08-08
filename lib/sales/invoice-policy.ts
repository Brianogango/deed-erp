/**
 * Resolve Odoo-style invoicing policy for a sale-order line.
 * Product setting wins; missing product defaults to delivered quantities
 * for stockable goods (safer for hardware) and ordered for services.
 */

import type { InvoicePolicy } from '@/lib/odoo-sales-flow'

export function resolveInvoicePolicy(opts: {
  linePolicy?: unknown
  productPolicy?: unknown
  productUnit?: unknown
  /** Prisma Product.trackStock — false means service / non-stockable. */
  trackStock?: unknown
}): InvoicePolicy {
  const fromLine = normalizePolicy(opts.linePolicy)
  if (fromLine) return fromLine
  const fromProduct = normalizePolicy(opts.productPolicy)
  if (fromProduct) return fromProduct
  const unit = String(opts.productUnit ?? '').toLowerCase()
  if (unit === 'service' || unit === 'services') return 'order'
  if (opts.trackStock === false) return 'order'
  return 'delivery'
}

function normalizePolicy(raw: unknown): InvoicePolicy | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'order' || value === 'ordered' || value === 'ordered_quantities') return 'order'
  if (value === 'delivery' || value === 'delivered' || value === 'delivered_quantities') return 'delivery'
  return null
}
