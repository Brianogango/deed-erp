/**
 * Simplify cash account filter when a specific code is requested.
 */
import 'server-only'
import prisma from '@/lib/prisma'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'

const CASH_CODES = [
  COA_ROLE_CODES.bank_absa,
  COA_ROLE_CODES.bank_equity,
  COA_ROLE_CODES.cash_mobile,
]

export type CashbookPrismaEntry = {
  id: string
  date: string
  ref: string
  description: string
  accountCode: string
  accountLabel: string
  debit: number
  credit: number
  sourceType: string | null
  paymentId: string | null
}

export async function buildCashbookEntriesFromPrisma(params: {
  dateFrom?: string | null
  dateTo?: string | null
  bankAccountCode?: string | null
  take?: number
}): Promise<{ rows: CashbookPrismaEntry[]; totals: { debit: number; credit: number } }> {
  const entryWhere: Record<string, unknown> = { isPosted: true, isReversed: false }
  if (params.dateFrom || params.dateTo) {
    entryWhere.entryDate = {
      ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00Z`) } : {}),
      ...(params.dateTo ? { lte: new Date(`${params.dateTo}T23:59:59Z`) } : {}),
    }
  }

  const codes = params.bankAccountCode
    ? [params.bankAccountCode]
    : CASH_CODES

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: entryWhere,
      OR: [
        { account: { code: { in: codes } } },
        ...codes.map(code => ({ accountLabel: { startsWith: code } })),
      ],
    },
    include: {
      journalEntry: {
        select: {
          id: true,
          ref: true,
          entryDate: true,
          description: true,
          sourceType: true,
          paymentId: true,
        },
      },
      account: { select: { code: true, name: true } },
    },
    orderBy: [{ journalEntry: { entryDate: 'desc' } }, { sortOrder: 'asc' }],
    take: Math.min(Math.max(params.take || 500, 1), 2000),
  })

  const rows: CashbookPrismaEntry[] = lines.map(l => {
    const code = l.account?.code || (l.accountLabel.match(/^(\d{3,6})\b/)?.[1] ?? '')
    return {
      id: l.id,
      date: l.journalEntry.entryDate.toISOString().slice(0, 10),
      ref: l.journalEntry.ref,
      description: l.label || l.journalEntry.description || '',
      accountCode: code,
      accountLabel: l.accountLabel,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      sourceType: l.journalEntry.sourceType,
      paymentId: l.journalEntry.paymentId,
    }
  })

  const totals = rows.reduce(
    (a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }),
    { debit: 0, credit: 0 },
  )

  return { rows, totals }
}
