import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { backfillInventoryDeviceConfig } from '@/lib/reconfiguration/backfill-device-config'

export const dynamic = 'force-dynamic'

/** Idempotent: parse existing laptop/desktop titles into product.specs and empty serial.specs. */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requirePermission('inventory.products.create')
    const result = await backfillInventoryDeviceConfig()
    return NextResponse.json({
      ok: true,
      productsUpdated: result.productsUpdated,
      serialsUpdated: result.serialsUpdated,
      productsSkippedBare: result.productsSkippedBare,
      serials: result.serials,
    })
  })
}
