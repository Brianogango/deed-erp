import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { normalizeInventoryTags } from '@/lib/inventory/normalize-inventory-tags'

export const dynamic = 'force-dynamic'

/** Idempotent: rewrite legacy INV-* tags so the tag is the manufacturer serial. */
export async function POST() {
  return withApiErrorHandling(async () => {
    await requirePermission('inventory.serials.manage')
    const result = await normalizeInventoryTags()
    return NextResponse.json({
      ok: true,
      rewritten: result.rewritten,
      total: result.total,
      // The whole list only when something changed — it is ~250 KB.
      ...(result.rewritten > 0 ? { serials: result.serials } : {}),
    })
  })
}
