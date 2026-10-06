/**
 * Invoices with more than one live sales entry (lib/accounting/duplicate-invoice-journals.ts).
 * GET  — what would be kept and reversed.
 * POST — reverse the extra copies (director only).
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { findDuplicateInvoiceJournals, reverseDuplicateInvoiceJournals } from '@/lib/accounting/duplicate-invoice-journals.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    return NextResponse.json({ rows: await findDuplicateInvoiceJournals() })
  })
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    return NextResponse.json({ results: await reverseDuplicateInvoiceJournals(actor.id) })
  })
}
