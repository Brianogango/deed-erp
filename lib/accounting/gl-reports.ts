import 'server-only'
import { getReportingPrisma } from '@/lib/infra/reporting-db'

export function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

export type AggregatedAccount = {
  id: string
  code: string
  name: string
  type: string
  group: string
  subGroup: string
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
      subGroup?: string | null
    } | null
  }>,
): Map<string, AggregatedAccount> {
  const map = new Map<string, AggregatedAccount>()
  for (const line of lines) {
    if (!line.account) {
      throw new Error(`Unmapped journal account in reporting: ${line.accountLabel}`)
    }
    const code = line.account.code
    const name = line.account.name
    const type = line.account.accountType
    const group = line.account.accountGroup || ''
    const subGroup = line.account.subGroup || ''
    const key = code
    const row = map.get(key) || { id: key, code, name, type, group, subGroup, debit: 0, credit: 0 }
    if (!row.subGroup && subGroup) row.subGroup = subGroup
    if (!row.group && group) row.group = group
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
  equationDifference: number
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
  let currentEarnings = 0

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
    } else if (row.type === 'revenue') {
      currentEarnings += amount
    } else if (row.type === 'expense') {
      currentEarnings -= amount
    }
  }

  if (Math.abs(currentEarnings) >= 0.01) {
    const earnings = round2(currentEarnings)
    equity.push({
      code: 'CURRENT_EARNINGS',
      name: 'Current period earnings',
      type: 'equity',
      group: 'Current earnings',
      amount: earnings,
    })
    totalEquity += earnings
  }

  assets.sort((a, b) => a.code.localeCompare(b.code))
  liabilities.sort((a, b) => a.code.localeCompare(b.code))
  equity.sort((a, b) => a.code.localeCompare(b.code))

  totalAssets = round2(totalAssets)
  totalLiabilities = round2(totalLiabilities)
  totalEquity = round2(totalEquity)
  const equationDifference = round2(totalAssets - (totalLiabilities + totalEquity))

  return {
    currency: 'KES',
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    equationDifference,
    balanced: Math.abs(equationDifference) < 0.01,
  }
}

export async function fetchPostedLines(opts: { dateFrom?: string; dateTo?: string; asOf?: string }) {
  const entryWhere: Record<string, unknown> = { isPosted: true }
  if (opts.dateFrom || opts.dateTo || opts.asOf) {
    const entryDate: Record<string, Date> = {}
    if (opts.dateFrom) entryDate.gte = new Date(`${opts.dateFrom}T00:00:00Z`)
    if (opts.dateTo) entryDate.lte = new Date(`${opts.dateTo}T23:59:59Z`)
    if (opts.asOf && !opts.dateTo) entryDate.lte = new Date(`${opts.asOf}T23:59:59Z`)
    entryWhere.entryDate = entryDate
  }

  const prisma = getReportingPrisma()
  return prisma.journalEntryLine.findMany({
    where: { journalEntry: entryWhere },
    select: {
      accountId: true,
      accountLabel: true,
      debit: true,
      credit: true,
      account: {
        select: {
          code: true,
          name: true,
          accountType: true,
          accountGroup: true,
          subGroup: true,
        },
      },
    },
  })
}

export function buildTrialBalanceFromAggregates(
  map: Map<string, AggregatedAccount>,
  asOf: string,
) {
  const rows = Array.from(map.values())
    .map(r => {
      const net = round2(r.debit - r.credit)
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type,
        group: r.group,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        grossDebit: round2(r.debit),
        grossCredit: round2(r.credit),
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code))

  const totals = rows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 },
  )

  return {
    currency: 'KES',
    asOf,
    rows,
    totals: {
      debit: round2(totals.debit),
      credit: round2(totals.credit),
    },
    balanced: Math.abs(totals.debit - totals.credit) < 0.02,
  }
}

export async function buildTrialBalance(opts: { asOf?: string }) {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10)
  const lines = await fetchPostedLines({ asOf })
  return buildTrialBalanceFromAggregates(aggregateJournalLines(lines), asOf)
}

export async function buildProfitAndLoss(opts: { dateFrom?: string; dateTo?: string }) {
  const lines = await fetchPostedLines(opts)
  return buildProfitAndLossFromAggregates(aggregateJournalLines(lines), opts)
}

export async function buildManagementProfitAndLoss(opts: { dateFrom?: string; dateTo?: string }) {
  const { buildManagementProfitAndLossFromAggregates } = await import('@/lib/accounting/management-pl')
  const lines = await fetchPostedLines(opts)
  return buildManagementProfitAndLossFromAggregates(aggregateJournalLines(lines), opts)
}

export async function buildBalanceSheet(opts: { asOf: string }) {
  const lines = await fetchPostedLines({ asOf: opts.asOf })
  return buildBalanceSheetFromAggregates(aggregateJournalLines(lines), opts.asOf)
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

function accountDelta(type: string, debit: number, credit: number) {
  return type === 'asset' || type === 'expense' ? debit - credit : credit - debit
}

export async function buildGeneralLedger(opts: {
  accountCode?: string
  accountId?: string
  dateFrom?: string
  dateTo?: string
}) {
  const prisma = getReportingPrisma()
  const accountFilter: Record<string, unknown> = {}
  if (opts.accountId) {
    accountFilter.accountId = opts.accountId
  } else if (opts.accountCode) {
    accountFilter.OR = [
      { account: { code: opts.accountCode } },
      { accountLabel: { startsWith: `${opts.accountCode} ` } },
      { accountLabel: { startsWith: `${opts.accountCode} -` } },
    ]
  }

  let openingBalance = 0
  if (opts.dateFrom) {
    const openingLines = await prisma.journalEntryLine.findMany({
      where: {
        ...accountFilter,
        journalEntry: {
          isPosted: true,
          entryDate: { lt: new Date(`${opts.dateFrom}T00:00:00Z`) },
        },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { accountType: true } },
        accountLabel: true,
      },
    })
    for (const line of openingLines) {
      if (!line.account) throw new Error(`Unmapped journal account in GL opening balance: ${line.accountLabel}`)
      openingBalance = round2(openingBalance + accountDelta(line.account.accountType, Number(line.debit), Number(line.credit)))
    }
  }

  const entryWhere: Record<string, unknown> = { isPosted: true }
  if (opts.dateFrom || opts.dateTo) {
    const entryDate: Record<string, Date> = {}
    if (opts.dateFrom) entryDate.gte = new Date(`${opts.dateFrom}T00:00:00Z`)
    if (opts.dateTo) entryDate.lte = new Date(`${opts.dateTo}T23:59:59Z`)
    entryWhere.entryDate = entryDate
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: { ...accountFilter, journalEntry: entryWhere },
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
    orderBy: [
      { journalEntry: { entryDate: 'asc' } },
      { journalEntry: { ref: 'asc' } },
      { sortOrder: 'asc' },
    ],
  })

  let running = openingBalance
  const result: GeneralLedgerLine[] = []
  for (const line of lines) {
    if (!line.account) throw new Error(`Unmapped journal account in GL: ${line.accountLabel}`)
    const debit = Number(line.debit || 0)
    const credit = Number(line.credit || 0)
    running = round2(running + accountDelta(line.account.accountType, debit, credit))
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
    openingBalance,
    lines: result,
    closingBalance: running,
  }
}
