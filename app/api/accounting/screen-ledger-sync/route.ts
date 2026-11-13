/**
 * Documents and payments on the screens that never reached the ledger
 * (lib/accounting/screen-ledger-sync.ts).
 * GET  — what would be booked.
 * POST — book them through the normal invoice and payment routes (director).
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { applyScreenLedgerSync, findScreenLedgerGaps } from '@/lib/accounting/screen-ledger-sync.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.manage')
    return NextResponse.json(await findScreenLedgerGaps())
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('accounting.ledger_repair')
    return NextResponse.json({ results: await applyScreenLedgerSync(actor.id) })
  })
}
