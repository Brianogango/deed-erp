/**
 * Management P&L helpers (Finance Phase 8).
 * Classifies posted GL aggregates into revenue / COGS / opex / finance using CoA groups.
 * Pure — no DB / no server-only. Analytic tags / budgets are out of scope.
 */

export function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

export function netBalanceForType(type: string, debit: number, credit: number): number {
  const net = round2(debit - credit)
  if (type === 'asset' || type === 'expense') return net
  return round2(credit - debit)
}

export type AggregateLike = {
  code: string
  name: string
  type: string
  group: string
  subGroup?: string
  debit: number
  credit: number
}

export type ProfitAndLossRow = {
  code: string
  name: string
  type: string
  group: string
  amount: number
}

export type ExpenseBucket = 'cogs' | 'operating' | 'finance'

/** CoA groups treated as cost of sales / direct cost (matches Accounting.tsx P&L lists). */
const COGS_GROUPS = new Set([
  'Direct Expenses',
  'Other Direct Expenses',
  'Local Purchases',
  'Import Purchases',
  'Inventory - Opening',
  'Inventory - Closing',
])

const FINANCE_GROUPS = new Set(['Finance Costs', 'Financial Expenses'])

const OPERATING_GROUPS = new Set(['Operating Expenses', 'Employment Expenses'])

const OTHER_INCOME_GROUPS = new Set(['Other Income'])

export function classifyExpenseBucket(row: {
  code?: string
  group?: string
  subGroup?: string
}): ExpenseBucket {
  const group = String(row.group || '').trim()
  const sub = String(row.subGroup || '').trim().toUpperCase()
  const code = String(row.code || '').trim()

  if (sub === 'COGS' || COGS_GROUPS.has(group)) return 'cogs'
  if (FINANCE_GROUPS.has(group)) return 'finance'
  if (OPERATING_GROUPS.has(group)) return 'operating'

  // Code-range fallbacks when CoA group is missing (blob-mirrored / unlabeled lines).
  if (/^6[01]\d{2}$/.test(code)) return 'cogs'
  if (code === '6401' || /^65\d{2}$/.test(code)) return 'finance'
  if (/^6[2-9]\d{2}$/.test(code) || /^7\d{3}$/.test(code)) return 'operating'

  return 'operating'
}

export function isOtherIncomeGroup(group?: string): boolean {
  return OTHER_INCOME_GROUPS.has(String(group || '').trim())
}

export type ManagementGroupRollup = {
  group: string
  section: 'revenue' | 'other_income' | 'cogs' | 'operating' | 'finance'
  amount: number
}

export type ManagementProfitAndLossResult = {
  currency: string
  dateFrom: string | null
  dateTo: string | null
  view: 'management'
  revenue: ProfitAndLossRow[]
  otherIncome: ProfitAndLossRow[]
  totalRevenue: number
  totalOtherIncome: number
  totalIncome: number
  cogs: ProfitAndLossRow[]
  totalCogs: number
  grossProfit: number
  operatingExpenses: ProfitAndLossRow[]
  totalOperating: number
  financeCosts: ProfitAndLossRow[]
  totalFinance: number
  /** All expense buckets — same identity as flat P&L totalExpenses */
  totalExpenses: number
  netProfit: number
  byGroup: ManagementGroupRollup[]
  /** Flat compatibility mirror of all expense rows */
  expenses: ProfitAndLossRow[]
}

function toRow(row: AggregateLike, amount: number): ProfitAndLossRow {
  return {
    code: row.code,
    name: row.name,
    type: row.type,
    group: row.group,
    amount,
  }
}

function addToGroupMap(
  map: Map<string, ManagementGroupRollup>,
  group: string,
  section: ManagementGroupRollup['section'],
  amount: number,
) {
  const key = `${section}::${group || '(ungrouped)'}`
  const existing = map.get(key)
  if (existing) {
    existing.amount = round2(existing.amount + amount)
  } else {
    map.set(key, { group: group || '(ungrouped)', section, amount: round2(amount) })
  }
}

export function buildManagementProfitAndLossFromAggregates(
  aggregates: Map<string, AggregateLike> | Iterable<AggregateLike>,
  opts?: { dateFrom?: string | null; dateTo?: string | null },
): ManagementProfitAndLossResult {
  const values = aggregates instanceof Map ? aggregates.values() : aggregates

  const revenue: ProfitAndLossRow[] = []
  const otherIncome: ProfitAndLossRow[] = []
  const cogs: ProfitAndLossRow[] = []
  const operatingExpenses: ProfitAndLossRow[] = []
  const financeCosts: ProfitAndLossRow[] = []
  const expensesFlat: ProfitAndLossRow[] = []
  const groupMap = new Map<string, ManagementGroupRollup>()

  let totalRevenue = 0
  let totalOtherIncome = 0
  let totalCogs = 0
  let totalOperating = 0
  let totalFinance = 0

  for (const row of values) {
    if (row.type === 'revenue') {
      const amount = netBalanceForType('revenue', row.debit, row.credit)
      if (Math.abs(amount) < 0.01) continue
      const plRow = toRow(row, amount)
      if (isOtherIncomeGroup(row.group)) {
        otherIncome.push(plRow)
        totalOtherIncome += amount
        addToGroupMap(groupMap, row.group, 'other_income', amount)
      } else {
        revenue.push(plRow)
        totalRevenue += amount
        addToGroupMap(groupMap, row.group, 'revenue', amount)
      }
      continue
    }

    if (row.type === 'expense') {
      const amount = netBalanceForType('expense', row.debit, row.credit)
      if (Math.abs(amount) < 0.01) continue
      const plRow = toRow(row, amount)
      expensesFlat.push(plRow)
      const bucket = classifyExpenseBucket({
        code: row.code,
        group: row.group,
        subGroup: row.subGroup,
      })
      if (bucket === 'cogs') {
        cogs.push(plRow)
        totalCogs += amount
        addToGroupMap(groupMap, row.group, 'cogs', amount)
      } else if (bucket === 'finance') {
        financeCosts.push(plRow)
        totalFinance += amount
        addToGroupMap(groupMap, row.group, 'finance', amount)
      } else {
        operatingExpenses.push(plRow)
        totalOperating += amount
        addToGroupMap(groupMap, row.group, 'operating', amount)
      }
    }
  }

  const sortRows = (rows: ProfitAndLossRow[]) => rows.sort((a, b) => a.code.localeCompare(b.code))
  sortRows(revenue)
  sortRows(otherIncome)
  sortRows(cogs)
  sortRows(operatingExpenses)
  sortRows(financeCosts)
  sortRows(expensesFlat)

  totalRevenue = round2(totalRevenue)
  totalOtherIncome = round2(totalOtherIncome)
  totalCogs = round2(totalCogs)
  totalOperating = round2(totalOperating)
  totalFinance = round2(totalFinance)
  const totalIncome = round2(totalRevenue + totalOtherIncome)
  const totalExpenses = round2(totalCogs + totalOperating + totalFinance)
  const grossProfit = round2(totalIncome - totalCogs)
  const netProfit = round2(totalIncome - totalExpenses)

  const byGroup = [...groupMap.values()].sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.group.localeCompare(b.group)
  })

  return {
    currency: 'KES',
    dateFrom: opts?.dateFrom ?? null,
    dateTo: opts?.dateTo ?? null,
    view: 'management',
    revenue,
    otherIncome,
    totalRevenue,
    totalOtherIncome,
    totalIncome,
    cogs,
    totalCogs,
    grossProfit,
    operatingExpenses,
    totalOperating,
    financeCosts,
    totalFinance,
    totalExpenses,
    netProfit,
    byGroup,
    expenses: expensesFlat,
  }
}
