import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { budgetVariance } from '@/lib/accounting/budget-variance'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const budgetId = new URL(request.url).searchParams.get('budgetId')
    if (!budgetId) return NextResponse.json({ error: 'budgetId is required' }, { status: 422 })
    const budget = await prisma.analyticBudget.findUnique({
      where: { id: budgetId },
      include: { lines: { include: { analyticAccount: true }, orderBy: { createdAt: 'asc' } } },
    })
    if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 })
    const analyticIds = [...new Set(budget.lines.map(line => line.analyticAccountId))]
    const accountCodes = [...new Set(budget.lines.map(line => line.accountCode))]
    const [journalLines, accounts] = await Promise.all([
      prisma.journalEntryLine.findMany({
        where: {
          analyticAccountId: { in: analyticIds },
          account: { code: { in: accountCodes } },
          journalEntry: { isPosted: true, isReversed: false, entryDate: { gte: budget.dateFrom, lte: budget.dateTo } },
        },
        select: { analyticAccountId: true, debit: true, credit: true, account: { select: { code: true } } },
      }),
      prisma.accountCode.findMany({ where: { code: { in: accountCodes } }, select: { code: true, accountType: true } }),
    ])
    const accountTypes = new Map(accounts.map(account => [account.code, account.accountType]))
    const actuals = new Map<string, { debit: number; credit: number }>()
    for (const line of journalLines) {
      if (!line.analyticAccountId || !line.account) continue
      const key = `${line.analyticAccountId}:${line.account.code}`
      const current = actuals.get(key) || { debit: 0, credit: 0 }
      current.debit += Number(line.debit)
      current.credit += Number(line.credit)
      actuals.set(key, current)
    }
    const lines = budget.lines.map(line => {
      const totals = actuals.get(`${line.analyticAccountId}:${line.accountCode}`) || { debit: 0, credit: 0 }
      return {
        id: line.id,
        analyticAccount: { id: line.analyticAccount.id, code: line.analyticAccount.code, name: line.analyticAccount.name },
        accountCode: line.accountCode,
        ...budgetVariance({ plannedAmount: Number(line.plannedAmount), ...totals, accountType: accountTypes.get(line.accountCode) || '' }),
      }
    })
    return NextResponse.json({
      budget: { id: budget.id, name: budget.name, state: budget.state, currency: budget.currency, dateFrom: budget.dateFrom.toISOString().slice(0, 10), dateTo: budget.dateTo.toISOString().slice(0, 10) },
      lines,
      totals: {
        planned: lines.reduce((sum, line) => sum + line.planned, 0),
        actual: lines.reduce((sum, line) => sum + line.actual, 0),
        variance: lines.reduce((sum, line) => sum + line.variance, 0),
      },
    })
  })
}
