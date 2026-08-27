import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { roundMoney } from '@/lib/accounting/money'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const bankAccountId = searchParams.get('bankAccountId') || undefined
    const statements = await prisma.bankStatement.findMany({
      where: bankAccountId ? { bankAccountId } : undefined,
      orderBy: { dateTo: 'desc' },
      take: 50,
    })
    return NextResponse.json({ statements })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const bankAccountId = String(body.bankAccountId || '').trim()
    const statementRef = String(body.statementRef || '').trim()
    const dateFrom = String(body.dateFrom || '').trim()
    const dateTo = String(body.dateTo || '').trim()
    const lines = Array.isArray(body.lines) ? body.lines : []
    if (!bankAccountId || !statementRef || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'bankAccountId, statementRef, dateFrom, dateTo required' }, { status: 400 })
    }

    const statement = await prisma.bankStatement.create({
      data: {
        bankAccountId,
        statementRef,
        dateFrom: new Date(`${dateFrom}T00:00:00Z`),
        dateTo: new Date(`${dateTo}T00:00:00Z`),
        openingBalance: roundMoney(body.openingBalance),
        closingBalance: roundMoney(body.closingBalance),
        importedById: actor.id,
      },
    })

    if (lines.length > 0) {
      await prisma.bankStatementLine.createMany({
        data: lines.map((line: any, idx: number) => ({
          statementId: statement.id,
          externalId: String(line.externalId || `${statementRef}-${idx + 1}`).slice(0, 160),
          transactionDate: new Date(`${String(line.date || dateFrom)}T00:00:00Z`),
          description: line.description ? String(line.description) : null,
          reference: line.reference ? String(line.reference).slice(0, 160) : null,
          amount: roundMoney(line.amount),
          balance: line.balance != null ? roundMoney(line.balance) : null,
        })),
      })
    }

    await writeFinancialAudit({
      userId: actor.id,
      action: 'import_bank_statement',
      entityType: 'bank_statement',
      entityId: statement.id,
      newValues: { statementRef, lineCount: lines.length },
    })

    const savedLines = await prisma.bankStatementLine.findMany({
      where: { statementId: statement.id },
      orderBy: { transactionDate: 'asc' },
    })
    return NextResponse.json({ statement, lines: savedLines }, { status: 201 })
  })
}
