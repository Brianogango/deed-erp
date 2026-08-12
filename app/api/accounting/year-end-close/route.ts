import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { aggregateJournalLines } from '@/lib/accounting/gl-reports'
import { buildYearEndCloseLines, yearEndCloseRef } from '@/lib/accounting/year-end-close'

export const dynamic = 'force-dynamic'

/**
 * POST /api/accounting/year-end-close
 * Body: { fiscalYear: number }
 * Closes revenue/expense into 4003 Current Year P&L.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    const body = await request.json().catch(() => ({}))
    const fiscalYear = Number(body.fiscalYear || new Date().getFullYear() - 1)
    if (!Number.isFinite(fiscalYear) || fiscalYear < 2000) {
      return NextResponse.json({ error: 'Valid fiscalYear required' }, { status: 400 })
    }

    const existing = await prisma.yearEndClose.findUnique({ where: { fiscalYear } })
    if (existing) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        journalRef: existing.journalRef,
        netProfit: Number(existing.netProfit),
      })
    }

    const dateFrom = `${fiscalYear}-01-01`
    const dateTo = `${fiscalYear}-12-31`
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          isPosted: true,
          isReversed: false,
          entryDate: {
            gte: new Date(`${dateFrom}T00:00:00Z`),
            lte: new Date(`${dateTo}T23:59:59Z`),
          },
        },
      },
      select: {
        accountId: true,
        accountLabel: true,
        debit: true,
        credit: true,
        account: { select: { code: true, name: true, accountType: true, accountGroup: true } },
      },
    })

    const aggregates = aggregateJournalLines(lines)
    const plAccounts = [...aggregates.values()]
      .filter(a => a.type === 'revenue' || a.type === 'expense' || a.type === 'income' || a.type === 'cogs')
      .map(a => ({
        code: a.code,
        name: a.name,
        accountType: a.type,
        debit: a.debit,
        credit: a.credit,
      }))

    const built = buildYearEndCloseLines(plAccounts, fiscalYear)
    if (built.lines.length === 0) {
      return NextResponse.json({ error: 'No P&L balances to close' }, { status: 400 })
    }

    const ref = yearEndCloseRef(fiscalYear)
    const entry = await createJournalEntry({
      ref,
      journalCode: 'YE',
      description: `Year-end close ${fiscalYear} → 4003`,
      date: dateTo,
      sourceType: 'year_end_close',
      sourceId: String(fiscalYear),
      createdById: actor.id,
      skipIfExists: true,
      lines: built.lines.map(l => ({
        accountLabel: l.accountLabel,
        label: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    })

    await prisma.yearEndClose.create({
      data: {
        fiscalYear,
        journalRef: entry.ref || ref,
        netProfit: built.netProfit,
        targetAccount: '4003',
        createdById: actor.id,
        notes: body.notes ? String(body.notes) : null,
      },
    })

    return NextResponse.json({
      ok: true,
      journal: entry,
      netProfit: built.netProfit,
      fiscalYear,
    }, { status: 201 })
  })
}
