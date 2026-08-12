/**
 * CoA display alias / renumber map (Finance Phase 12).
 * Never rewrites posted journal account labels — display + role resolution only.
 */

import { COA_ROLE_CODES, type CoaRole } from '@/lib/accounting/coa-roles'

export type AccountAliasRow = {
  liveCode: string
  displayCode: string
  guideName?: string | null
}

/** Resolve a guide/display code back to the live production code. */
export function resolveLiveCode(
  codeOrDisplay: string,
  aliases: AccountAliasRow[] = [],
): string {
  const raw = String(codeOrDisplay || '').trim()
  if (!raw) return raw
  const byDisplay = aliases.find(a => a.displayCode === raw)
  if (byDisplay) return byDisplay.liveCode
  const byLive = aliases.find(a => a.liveCode === raw)
  if (byLive) return byLive.liveCode
  return raw
}

/** Map live code → preferred display code for reports/UI. */
export function displayCodeFor(
  liveCode: string,
  aliases: AccountAliasRow[] = [],
): string {
  const row = aliases.find(a => a.liveCode === liveCode)
  return row?.displayCode || liveCode
}

/** Seed aliases: guide-style numbers that map onto Deed live codes (documentation only). */
export const DEFAULT_COA_ALIASES: AccountAliasRow[] = [
  { liveCode: '1800', displayCode: '121000', guideName: 'Accounts Receivable' },
  { liveCode: '3000', displayCode: '211000', guideName: 'Accounts Payable' },
  { liveCode: '1200', displayCode: '110100', guideName: 'Stock Inventory' },
  { liveCode: '3301', displayCode: '251000', guideName: 'VAT Output' },
  { liveCode: '1150', displayCode: '141000', guideName: 'VAT Input' },
  { liveCode: '4003', displayCode: '999999', guideName: 'Current Year Earnings' },
  { liveCode: '5000', displayCode: '400000', guideName: 'Product Sales' },
  { liveCode: '6001', displayCode: '500000', guideName: 'Cost of Goods Sold' },
]

export function roleLiveCode(role: CoaRole): string {
  return COA_ROLE_CODES[role]
}
