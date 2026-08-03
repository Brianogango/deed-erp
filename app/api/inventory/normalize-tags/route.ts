import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { normalizeInventoryTags } from '@/lib/inventory/normalize-inventory-tags'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'inventory_officer', 'technical_lead']

/** Idempotent: rewrite legacy INV-* tags so the tag is the manufacturer serial. */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const result = await normalizeInventoryTags()
    return NextResponse.json({
      ok: true,
      rewritten: result.rewritten,
      total: result.total,
      serials: result.serials,
    })
  })
}
