import 'server-only'
import prisma from '@/lib/prisma'

export function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

export type AggregatedAccount = {
  id: string
  code: string
  name: string
  type: string
  group: string
  debit: number
  credit: number
}

export function aggregateJournalLines(
  lines: Array<{
    accountId: string | null
    accountLabel: string
    debit: unknown
    credit: unknown
    account?: {
      code: string
      name: string
      accountType: string
      accountGroup: string | null
    } | null
  }>,
): Map<string, AggregatedAccount> {
  const map = new Map<string, AggregatedAccount>()
  for (const line of lines) {
    const code = line.account?.code || (line.accountLabel.match(/^(\d{3,6})\b/)?.[1] ?? 'UNKNOWN')
    const name = line.account?.name || (line.accountLabel.includes(' - ')
      ? line.accountLabel.split(' - ').slice(1).join(' - ')
      : line.accountLabel)
    const type = line.account?.accountType || 'asset'
    const group = line.account?.accountGroup || ''
    const key = code
    const row = map.get(key) || { id: key, code, name, type, group, debit: 0, credit: 0 }
    row.debit += Number(line.debit || 0)
    row.credit += Number(line.credit || 0)
    map.set(key, row)
  }
  return map
}

export function netBalanceForType(type: string, debit: number, credit: number): number {
  const net = round2(debit - credit)
  if (type === 'asset' || type === 'expense') return net
  return round2(credit - debit)
}

export type ProfitAndLossRow = {
  code: string
  name: string
  type: string
  group: string
  amount: number
}

export type ProfitAndLossResult = {
  currency: string
  dateFrom: string | null
  dateTo: string | null
  revenue: ProfitAndLossRow[]
  expenses: ProfitAndLossRow[]
  totalRevenue: number
  totalExpenses: number
  netProfit: number
}

export function buildProfitAndLossFromAggregates(
  aggregates: Map<string, AggregatedAccount>,
  opts?: { dateFrom?: string | null; dateTo?: string | null },
): ProfitAndLossResult {
  const revenue: ProfitAndLossRow[] = []
  const expenses: ProfitAndLossRow[] = []
  let totalRevenue = 0
  let totalExpenses = 0

  for (const row of aggregates.values()) {
    if (row.type === 'revenue') {
      const amount = netBalanceForType('revenue', row.debit, row.credit)
      if (Math.abs(amount) < 0.01) continue
      revenue.push({ code: row.code, name: row.name, type: row.type, group: row.group, amount })
      totalRevenue += amount
    } else if (row.type === 'expense') {
      const amount = netBalanceForType('expense', row.debit, row.credit)
      if (Math.abs(amount) < 0.01) continue
      expenses.push({ code: row.code, name: row.name, type: row.type, group: row.group, amount })
      totalExpenses += amount
    }
  }

  revenue.sort((a, b) => a.code.localeCompare(b.code))
  expenses.sort((a, b) => a.code.localeCompare(b.code))

  return {
    currency: 'KES',
    dateFrom: opts?.dateFrom ?? null,
    dateTo: opts?.dateTo ?? null,
    revenue,
    expenses,
    totalRevenue: round2(totalRevenue),
    totalExpenses: round2(totalExpenses),
    netProfit: round2(totalRevenue - totalExpenses),
  }
}

export type BalanceSheetRow = {
  code: string
  name: string
  type: string
  group: string
  amount: number
}

export type BalanceSheetResult = {
  currency: string
  asOf: string
  assets: BalanceSheetRow[]
  liabilities: BalanceSheetRow[]
  equity: BalanceSheetRow[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  balanced: boolean
}

export function buildBalanceSheetFromAggregates(
  aggregates: Map<string, AggregatedAccount>,
  asOf: string,
): BalanceSheetResult {
  const assets: BalanceSheetRow[] = []
  const liabilities: BalanceSheetRow[] = []
  const equity: BalanceSheetRow[] = []
  let totalAssets = 0
  let totalLiabilities = 0
  let totalEquity = 0

  for (const row of aggregates.values()) {
    const amount = netBalanceForType(row.type, row.debit, row.credit)
    if (Math.abs(amount) < 0.01) continue
    const entry = { code: row.code, name: row.name, type: row.type, group: row.group, amount }
    if (row.type === 'asset') {
      assets.push(entry)
      totalAssets += amount
    } else if (row.type === 'liability') {
      liabilities.push(entry)
      totalLiabilities += amount
    } else if (row.type === 'equity') {
      equity.push(entry)
      totalEquity += amount
    }
  }

  assets.sort((a, b) => a.code.localeCompare(b.code))
  liabilities.sort((a, b) => a.code.localeCompare(b.code))
  equity.sort((a, b) => a.code.localeCompare(b.code))

  totalAssets = round2(totalAssets)
  totalLiabilities = round2(totalLiabilities)
  totalEquity = round2(totalEquity)

  return {
    currency: 'KES',
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.02,
  }
}

export async function fetchPostedLines(opts: { dateFrom?: string; dateTo?: string; asOf?: string }) {
  const entryWhere: Record<string, unknown> = { isPosted: true, isReversed: false }
  if (opts.dateFrom || opts.dateTo || opts.asOf) {
    const entryDate: Record<string, Date> = {}
    if (opts.dateFrom) entryDate.gte = new Date(`${opts.dateFrom}T00:00:00Z`)
    if (opts.dateTo) entryDate.lte = new Date(`${opts.dateTo}T23:59:59Z`)
    if (opts.asOf && !opts.dateTo) entryDate.lte = new Date(`${opts.asOf}T23:59:59Z`)
    entryWhere.entryDate = entryDate
  }

  return prisma.journalEntryLine.findMany({
    where: { journalEntry: entryWhere },
    select: {
      accountId: true,
      accountLabel: true,
      debit: true,
      credit: true,
      account: { select: { code: true, name: true, accountType: true, accountGroup: true } },
    },
  })
}

export async function buildProfitAndLoss(opts: { dateFrom?: string; dateTo?: string }) {
  const lines = await fetchPostedLines(opts)
  const aggregates = aggregateJournalLines(lines)
  return buildProfitAndLossFromAggregates(aggregates, opts)
}

export async function buildBalanceSheet(opts: { asOf: string }) {
  const lines = await fetchPostedLines({ asOf: opts.asOf })
  const aggregates = aggregateJournalLines(lines)
  return buildBalanceSheetFromAggregates(aggregates, opts.asOf)
}

export type GeneralLedgerLine = {
  id: string
  entryRef: string
  entryDate: string
  description: string
  label: string
  sourceType: string
  debit: number
  credit: number
  runningBalance: number
}

export async function buildGeneralLedger(opts: {
  accountCode?: string
  accountId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const entryWhere: Record<string, unknown> = { isPosted: true, isReversed: false }
  if (opts.dateFrom || opts.dateTo) {
    const entryDate: Record<string, Date> = {}
    if (opts.dateFrom) entryDate.gte = new Date(`${opts.dateFrom}T00:00:00Z`)
    if (opts.dateTo) entryDate.lte = new Date(`${opts.dateTo}T23:59:59Z`)
    entryWhere.entryDate = entryDate
  }

  const lineWhere: Record<string, unknown> = { journalEntry: entryWhere }
  if (opts.accountId) {
    lineWhere.accountId = opts.accountId
  } else if (opts.accountCode) {
    lineWhere.OR = [
      { account: { code: opts.accountCode } },
      { accountLabel: { startsWith: `${opts.accountCode} ` } },
      { accountLabel: { startsWith: `${opts.accountCode} -` } },
    ]
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: lineWhere,
    select: {
      id: true,
      accountLabel: true,
      label: true,
      debit: true,
      credit: true,
      account: { select: { code: true, accountType: true } },
      journalEntry: {
        select: {
          ref: true,
          entryDate: true,
          description: true,
          sourceType: true,
        },
      },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { sortOrder: 'asc' }],
  })

  let running = 0
  const result: GeneralLedgerLine[] = []
  for (const line of lines) {
    const type = line.account?.accountType || 'asset'
    const debit = Number(line.debit || 0)
    const credit = Number(line.credit || 0)
    const delta = type === 'asset' || type === 'expense' ? debit - credit : credit - debit
    running = round2(running + delta)
    result.push({
      id: line.id,
      entryRef: line.journalEntry.ref,
      entryDate: line.journalEntry.entryDate.toISOString().slice(0, 10),
      description: line.journalEntry.description || '',
      label: line.label || '',
      sourceType: line.journalEntry.sourceType || '',
      debit,
      credit,
      runningBalance: running,
    })
  }

  return {
    currency: 'KES',
    accountCode: opts.accountCode ?? null,
    accountId: opts.accountId ?? null,
    dateFrom: opts.dateFrom ?? null,
    dateTo: opts.dateTo ?? null,
    lines: result,
    closingBalance: running,
  }
}
