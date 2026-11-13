import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { applyQuantityReconcile, previewQuantityReconcile } from '@/lib/inventory/stock-reconcile.server'

export const dynamic = 'force-dynamic'

/** Quantity stock where the screen and the database disagree (lib/inventory/stock-reconcile.ts). */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('inventory.reconcile')
    return NextResponse.json({ rows: await previewQuantityReconcile() })
  })
}

/** Set both sides to the lower number. Director only. */
export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('inventory.reconcile.apply')
    return NextResponse.json(await applyQuantityReconcile({ id: user.id, username: user.username }))
  })
}
