import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { roundMoney } from '@/lib/accounting/money'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const statementDate = z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)
const bankStatementCreateSchema = z.object({
  bankAccountId: z.string().trim().min(1).max(80),
  statementRef: z.string().trim().min(1).max(160),
  dateFrom: statementDate,
  dateTo: statementDate,
  openingBalance: z.coerce.number().finite().min(-99_999_999_999.99).max(99_999_999_999.99),
  closingBalance: z.coerce.number().finite().min(-99_999_999_999.99).max(99_999_999_999.99),
  lines: z.array(z.object({
    externalId: z.string().trim().max(160).optional().nullable(),
    date: statementDate.optional(),
    description: z.string().trim().max(2_000).optional().nullable(),
    reference: z.string().trim().max(160).optional().nullable(),
    amount: z.coerce.number().finite().min(-99_999_999_999.99).max(99_999_999_999.99),
    balance: z.coerce.number().finite().min(-99_999_999_999.99).max(99_999_999_999.99).optional().nullable(),
  }).strict()).max(10_000).default([]),
}).strict()

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
    const parsed = bankStatementCreateSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid bank statement', issues: parsed.error.issues }, { status: 422 })
    }
    const body = parsed.data
    const bankAccountId = body.bankAccountId
    const statementRef = body.statementRef
    const dateFrom = body.dateFrom
    const dateTo = body.dateTo
    const lines = body.lines
    const fromDate = new Date(`${dateFrom}T00:00:00Z`)
    const toDate = new Date(`${dateTo}T00:00:00Z`)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate < fromDate) {
      return NextResponse.json({ error: 'Invalid bank statement date range' }, { status: 422 })
    }

    const statement = await prisma.bankStatement.create({
      data: {
        bankAccountId,
        statementRef,
        dateFrom: fromDate,
        dateTo: toDate,
        openingBalance: roundMoney(body.openingBalance),
        closingBalance: roundMoney(body.closingBalance),
        importedById: actor.id,
      },
    })

    if (lines.length > 0) {
      await prisma.bankStatementLine.createMany({
        data: lines.map((line, idx) => ({
          statementId: statement.id,
          externalId: line.externalId || `${statementRef}-${idx + 1}`.slice(0, 160),
          transactionDate: new Date(`${line.date || dateFrom}T00:00:00Z`),
          description: line.description || null,
          reference: line.reference || null,
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
