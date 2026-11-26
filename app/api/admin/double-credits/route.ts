/**
 * Paid invoices cancelled after a credit note, before the cancel took the
 * note into account: the customer was credited twice for the noted part.
 *
 * GET  — the cancel credits with an extra in them.
 * POST { creditId } — take the extra back (lower the credit, put the sale back).
 */
import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { findDoubleCredits, fixDoubleCredit } from '@/lib/finance/double-credit-fix.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.manage')
    return NextResponse.json({ rows: await findDoubleCredits() })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('accounting.manage')
    const body = await request.json().catch(() => ({})) as { creditId?: unknown }
    const creditId = String(body.creditId ?? '').trim()
    if (!creditId) return NextResponse.json({ error: 'creditId is required' }, { status: 400 })
    const lock = await checkFiscalLock(new Date())
    if (!lock.ok) return NextResponse.json({ error: lock.error }, { status: lock.status })
    const fixed = await fixDoubleCredit(creditId, { id: actor.id, name: actor.name || actor.username || 'Finance' })
    return NextResponse.json({ ok: true, fixed })
  })
}
