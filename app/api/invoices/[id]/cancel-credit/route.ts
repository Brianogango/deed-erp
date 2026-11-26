/**
 * GET — what cancelling this paid invoice would give the customer as credit:
 * what they paid, less what was already credited on it (credit notes).
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { canCancelOrResetInvoice } from '@/lib/finance-controls'
import { cancelCreditForInvoice } from '@/lib/finance/cancel-credit.server'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

export async function GET(_request: Request, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('repair.invoice.edit')
    if (!canCancelOrResetInvoice(actor.role)) {
      return NextResponse.json({ error: 'Only Finance, Admin Officer, or Director can cancel invoices' }, { status: 403 })
    }
    const { id } = await resolveRouteParams(params)
    const invoice = await prisma.invoice.findUnique({ where: { id }, select: { id: true, amountPaid: true, totalAmount: true } })
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    const { alreadyCredited, creditable } = await cancelCreditForInvoice(invoice)
    return NextResponse.json({ amountPaid: Number(invoice.amountPaid), alreadyCredited, creditable })
  })
}
