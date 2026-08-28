import 'server-only'
import prisma from '@/lib/prisma'
import {
  aggregateJournalLines,
  fetchPostedLines,
  round2,
} from '@/lib/accounting/gl-reports'
import {
  buildCashFlowFromMovements,
  isCashAccountCode,
  openingCashFromAggregates,
  type CashFlowLine,
} from '@/lib/accounting/cash-flow'

function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function buildCashFlowStatement(opts: { dateFrom: string; dateTo: string }) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      isPosted: true,
      entryDate: {
        gte: new Date(`${opts.dateFrom}T00:00:00Z`),
        lte: new Date(`${opts.dateTo}T23:59:59Z`),
      },
    },
    select: {
      id: true,
      lines: {
        select: {
          debit: true,
          credit: true,
          accountLabel: true,
          account: { select: { code: true, name: true } },
        },
      },
    },
  })

  const movements: CashFlowLine[] = []
  for (const entry of entries) {
    const cashLines = []
    const contraLines = []
    for (const line of entry.lines) {
      if (!line.account) continue
      const row = {
        code: line.account.code,
        name: line.account.name,
        debit: Number(line.debit || 0),
        credit: Number(line.credit || 0),
      }
      if (isCashAccountCode(row.code)) cashLines.push(row)
      else contraLines.push(row)
    }
    const cashNet = round2(cashLines.reduce((s, l) => s + l.debit - l.credit, 0))
    if (cashNet === 0) continue
    const contraAbs = contraLines.reduce((s, l) => s + Math.abs(l.debit - l.credit), 0)
    if (contraLines.length === 0 || contraAbs === 0) {
      movements.push({
        accountCode: cashLines[0]?.code || '22',
        contraCode: '9999',
        contraName: 'Unclassified cash movement',
        debit: cashNet > 0 ? cashNet : 0,
        credit: cashNet < 0 ? Math.abs(cashNet) : 0,
        entryId: entry.id,
      })
      continue
    }
    for (const contra of contraLines) {
      const weight = Math.abs(contra.debit - contra.credit) / contraAbs
      const share = round2(cashNet * weight)
      movements.push({
        accountCode: cashLines[0]?.code || '22',
        contraCode: contra.code,
        contraName: contra.name,
        debit: share > 0 ? share : 0,
        credit: share < 0 ? Math.abs(share) : 0,
        entryId: entry.id,
      })
    }
  }

  const openingLines = await fetchPostedLines({ asOf: dayBefore(opts.dateFrom) })
  const openingCash = openingCashFromAggregates(aggregateJournalLines(openingLines))
  return buildCashFlowFromMovements({
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    cashMovements: movements,
    openingCash,
  })
}
