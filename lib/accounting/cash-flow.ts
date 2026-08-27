/**
 * Cash-flow statement from posted cash-account journal lines (direct method).
 * Contra-account codes classify operating / investing / financing.
 */

import { round2, type AggregatedAccount } from '@/lib/accounting/gl-reports'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'

export type CashFlowRow = { code: string; name: string; amount: number }

export type CashFlowResult = {
  currency: string
  dateFrom: string
  dateTo: string
  operating: CashFlowRow[]
  investing: CashFlowRow[]
  financing: CashFlowRow[]
  totalOperating: number
  totalInvesting: number
  totalFinancing: number
  netChange: number
  openingCash: number
  closingCash: number
}

const CASH_PREFIXES = ['22']
const INVESTING_PREFIXES = ['17', '16']
const FINANCING_PREFIXES = ['40', '35', '34']

export function isCashAccountCode(code: string) {
  return CASH_PREFIXES.some(p => code.startsWith(p))
}

function sectionForContra(code: string): 'operating' | 'investing' | 'financing' {
  if (INVESTING_PREFIXES.some(p => code.startsWith(p))) return 'investing'
  if (FINANCING_PREFIXES.some(p => code.startsWith(p))) return 'financing'
  if (code === COA_ROLE_CODES.inventory) return 'operating'
  return 'operating'
}

export type CashFlowLine = {
  accountCode: string
  contraCode: string
  contraName: string
  debit: number
  credit: number
  entryId: string
}

/**
 * Each cash line's signed movement (debit − credit) is cash in/(out).
 * Grouped by contra account into IAS 7 sections.
 */
export function buildCashFlowFromMovements(params: {
  dateFrom: string
  dateTo: string
  cashMovements: CashFlowLine[]
  openingCash: number
}): CashFlowResult {
  const buckets = {
    operating: new Map<string, CashFlowRow>(),
    investing: new Map<string, CashFlowRow>(),
    financing: new Map<string, CashFlowRow>(),
  }

  for (const line of params.cashMovements) {
    const amount = round2(Number(line.debit || 0) - Number(line.credit || 0))
    if (amount === 0) continue
    const section = sectionForContra(line.contraCode)
    const key = line.contraCode
    const existing = buckets[section].get(key)
    if (existing) existing.amount = round2(existing.amount + amount)
    else buckets[section].set(key, { code: line.contraCode, name: line.contraName, amount })
  }

  const pack = (map: Map<string, CashFlowRow>) =>
    Array.from(map.values()).filter(r => r.amount !== 0).sort((a, b) => a.code.localeCompare(b.code))

  const operating = pack(buckets.operating)
  const investing = pack(buckets.investing)
  const financing = pack(buckets.financing)
  const totalOperating = round2(operating.reduce((s, r) => s + r.amount, 0))
  const totalInvesting = round2(investing.reduce((s, r) => s + r.amount, 0))
  const totalFinancing = round2(financing.reduce((s, r) => s + r.amount, 0))
  const netChange = round2(totalOperating + totalInvesting + totalFinancing)

  return {
    currency: 'KES',
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    operating,
    investing,
    financing,
    totalOperating,
    totalInvesting,
    totalFinancing,
    netChange,
    openingCash: round2(params.openingCash),
    closingCash: round2(params.openingCash + netChange),
  }
}

export function openingCashFromAggregates(map: Map<string, AggregatedAccount>): number {
  let cash = 0
  for (const row of map.values()) {
    if (isCashAccountCode(row.code)) cash += row.debit - row.credit
  }
  return round2(cash)
}
