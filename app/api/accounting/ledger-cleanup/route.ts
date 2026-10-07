/**
 * Duplicate deposit entries and missing VAT records (lib/accounting/ledger-cleanup.ts).
 * GET  — what would be corrected.
 * POST — correct it (director only).
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyLedgerCleanup, findLedgerCleanup } from '@/lib/accounting/ledger-cleanup.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    return NextResponse.json(await findLedgerCleanup())
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    return NextResponse.json({ results: await applyLedgerCleanup(actor.id) })
  })
}
