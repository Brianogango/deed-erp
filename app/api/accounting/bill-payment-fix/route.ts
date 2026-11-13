/**
 * Supplier-bill payments booked as customer receipts (lib/accounting/bill-payment-fix.ts).
 * GET  — the payments affected and what would be posted.
 * POST — correct them (director only).
 */
import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { applyBillPaymentFixes, findBillPaymentFixes } from '@/lib/accounting/bill-payment-fix.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('accounting.manage')
    return NextResponse.json({ rows: await findBillPaymentFixes() })
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('accounting.ledger_repair')
    return NextResponse.json({ results: await applyBillPaymentFixes(actor.id) })
  })
}
