import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { backfillInventoryDeviceConfig } from '@/lib/reconfiguration/backfill-device-config'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

/** Idempotent: parse existing laptop/desktop titles into product.specs and empty serial.specs. */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
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
