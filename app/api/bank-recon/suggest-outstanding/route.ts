import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { canManageBankRecon } from '@/lib/finance-controls'
import { paymentAllocatedSum, paymentUnallocated } from '@/lib/accounting/residuals'
import {
  suggestOutstandingPaymentMatches,
  type MatchableStatementLine,
} from '@/lib/accounting/bank-statement-match'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bank-recon/suggest-outstanding
 * Suggest Phase 2 outstanding payments that match a statement line (amount/date/direction).
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    if (!canManageBankRecon(actor.role)) {
      return NextResponse.json({ error: 'Only Finance or Director can match bank outstanding' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const statementLine: MatchableStatementLine = {
      id: String(body.id || body.statementLineId || 'stmt'),
      date: String(body.date || ''),
      debit: Number(body.debit || 0),
      credit: Number(body.credit || 0),
      reference: body.reference ? String(body.reference) : undefined,
      description: body.description ? String(body.description) : undefined,
    }
    if (!statementLine.date || (statementLine.debit <= 0 && statementLine.credit <= 0)) {
      return NextResponse.json({ error: 'statement line date and amount required' }, { status: 400 })
    }

    const payments = await prisma.payment.findMany({
      where: { isVoided: false },
      include: { allocations: true },
      orderBy: { paidAt: 'desc' },
      take: 300,
    })

    const candidates = payments
      .map(p => {
        const allocatedSum = paymentAllocatedSum(
          p.allocations.map(a => ({ amount: Number(a.amount) })),
        )
        const unallocated = paymentUnallocated(Number(p.amount), allocatedSum)
        if (unallocated <= 0.009) return null
        return {
          id: p.id,
          amount: Number(p.amount),
          allocatedSum,
          paidAt: p.paidAt,
          reference: p.reference,
          notes: p.notes,
          direction: String(p.notes || '').includes('direction:outbound')
            ? 'outbound' as const
            : 'inbound' as const,
        }
      })
      .filter(Boolean) as Array<{
        id: string
        amount: number
        allocatedSum: number
        paidAt: Date
        reference: string | null
        notes: string | null
        direction: 'inbound' | 'outbound'
      }>

    const suggestions = suggestOutstandingPaymentMatches({
      statementLine,
      payments: candidates,
    })

    return NextResponse.json({ suggestions })
  })
}
