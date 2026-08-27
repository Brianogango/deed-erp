import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { roundMoney } from '@/lib/accounting/money'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const statement = await prisma.bankStatement.findUnique({ where: { id: params.id } })
    if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const lines = await prisma.bankStatementLine.findMany({
      where: { statementId: params.id },
      orderBy: { transactionDate: 'asc' },
    })
    const matches = await prisma.bankReconciliationMatch.findMany({
      where: { statementLineId: { in: lines.map(l => l.id) }, reversedAt: null },
    })
    return NextResponse.json({ statement, lines, matches })
  })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || 'match')
    const statement = await prisma.bankStatement.findUnique({ where: { id: params.id } })
    if (!statement) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'reconcile') {
      const lines = await prisma.bankStatementLine.findMany({ where: { statementId: params.id } })
      const open = lines.filter(l => l.reconciliationStatus === 'unreconciled')
      if (open.length > 0) {
        return NextResponse.json(
          { error: `${open.length} statement line(s) still unreconciled` },
          { status: 409 },
        )
      }
      const next = await prisma.bankStatement.update({
        where: { id: params.id },
        data: { status: 'reconciled', reconciledAt: new Date(), reconciledById: actor.id },
      })
      await writeFinancialAudit({
        userId: actor.id,
        action: 'reconcile_bank_statement',
        entityType: 'bank_statement',
        entityId: params.id,
      })
      return NextResponse.json({ statement: next })
    }

    const statementLineId = String(body.statementLineId || '').trim()
    const journalEntryId = String(body.journalEntryId || '').trim()
    if (!statementLineId || !journalEntryId) {
      return NextResponse.json({ error: 'statementLineId and journalEntryId required' }, { status: 400 })
    }
    const line = await prisma.bankStatementLine.findUnique({ where: { id: statementLineId } })
    if (!line || line.statementId !== params.id) {
      return NextResponse.json({ error: 'Statement line not found' }, { status: 404 })
    }
    const journal = await prisma.journalEntry.findUnique({ where: { id: journalEntryId }, select: { id: true, totalDebit: true } })
    if (!journal) return NextResponse.json({ error: 'Journal not found' }, { status: 404 })

    const match = await prisma.bankReconciliationMatch.create({
      data: {
        statementLineId,
        journalEntryId,
        amount: roundMoney(body.amount ?? line.amount),
        matchedById: actor.id,
      },
    })
    await prisma.bankStatementLine.update({
      where: { id: statementLineId },
      data: { reconciliationStatus: 'matched' },
    })
    await writeFinancialAudit({
      userId: actor.id,
      action: 'match_bank_statement_line',
      entityType: 'bank_statement',
      entityId: params.id,
      relatedJournalId: journalEntryId,
      newValues: { statementLineId },
    })
    return NextResponse.json({ match })
  })
}
