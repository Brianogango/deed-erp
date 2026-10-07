/**
 * Payment entries booked more than once and confirmed documents with no entry (lib/accounting/document-ledger-repair.ts).
 * GET  — what would be corrected.
 * POST — correct it (director only).
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { applyDocumentLedgerRepairs, approveReviewRows, findDocumentLedgerRepairs } from '@/lib/accounting/document-ledger-repair.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    return NextResponse.json(await findDocumentLedgerRepairs())
  })
}

/** Body `{ approve: [invoiceId, …] }` applies only those review rows. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    const body = await request.json().catch(() => null) as { approve?: unknown } | null
    if (Array.isArray(body?.approve)) {
      const ids = body.approve.map(String).filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200)
      return NextResponse.json({ results: await approveReviewRows(ids, actor.id) })
    }
    return NextResponse.json({ results: await applyDocumentLedgerRepairs(actor.id) })
  })
}
