import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { normalizeSerialOnlyProductTracking } from '@/lib/inventory/normalize-serial-tracking'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

/** One-shot / idempotent: set trackingMethod=SERIAL for all Laptops (and other machine categories). */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const result = await normalizeSerialOnlyProductTracking()
    return NextResponse.json({ ok: true, ...result })
  })
}
