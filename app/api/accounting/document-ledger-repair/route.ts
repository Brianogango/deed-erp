/**
 * Payment entries booked more than once and confirmed documents with no entry (lib/accounting/document-ledger-repair.ts).
 * GET  — what would be corrected.
 * POST — correct it (director only).
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyDocumentLedgerRepairs, findDocumentLedgerRepairs } from '@/lib/accounting/document-ledger-repair.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    return NextResponse.json(await findDocumentLedgerRepairs())
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    return NextResponse.json({ results: await applyDocumentLedgerRepairs(actor.id) })
  })
}
