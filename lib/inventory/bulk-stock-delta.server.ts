import 'server-only'

import prisma from '@/lib/prisma'
import type { BulkStockDelta } from './bulk-stock-delta'

/**
 * Add each change to the stored quantity in one statement per row, all in one
 * transaction: "qty = qty + change", never "qty = what this writer read". Two
 * writers at once both count, and a stale list cannot set a quantity back.
 * Quantities never go below zero.
 */
export async function applyBulkStockDeltasToTable(deltas: BulkStockDelta[]): Promise<number> {
  const real = deltas.filter(d => d.delta !== 0 && d.productId)
  if (!real.length) return 0
  await prisma.$transaction(real.map(d => prisma.$executeRaw`
    INSERT INTO stock_location_levels (product_id, location, qty, updated_at)
    VALUES (${d.productId.slice(0, 80)}, ${(d.location || 'warehouse').slice(0, 40)}, ${Math.max(0, d.delta)}, now())
    ON CONFLICT (product_id, location) DO UPDATE
      SET qty = GREATEST(0, stock_location_levels.qty + ${d.delta}), updated_at = now()
  `))
  return real.length
}
