import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyQuantityReconcile, previewQuantityReconcile } from '@/lib/inventory/stock-reconcile.server'

export const dynamic = 'force-dynamic'

/** Quantity stock where the screen and the database disagree (lib/inventory/stock-reconcile.ts). */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'admin_officer', 'inventory_officer', 'finance_officer'])
    return NextResponse.json({ rows: await previewQuantityReconcile() })
  })
}

/** Set both sides to the lower number. Director only. */
export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await requireRole(['director'])
    return NextResponse.json(await applyQuantityReconcile({ id: user.id, username: user.username }))
  })
}
