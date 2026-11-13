import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { normalizeSerialOnlyProductTracking } from '@/lib/inventory/normalize-serial-tracking'

export const dynamic = 'force-dynamic'

/** One-shot / idempotent: set trackingMethod=SERIAL for all Laptops (and other machine categories). */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requirePermission('inventory.products.create')
    const result = await normalizeSerialOnlyProductTracking()
    return NextResponse.json({ ok: true, ...result })
  })
}
