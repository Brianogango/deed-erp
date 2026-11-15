/**
 * Journal lines for the three money movements that used to leave no trace in
 * Finance: an exchange's price difference, stock given away, and a marketplace
 * settlement. Pure functions — the store actions turn these into entries.
 *
 * Accounts are picked from the chart the tenant actually has, first match
 * wins, the way rider fees already do it (lib/delivery/rider-direct-pay.ts).
 */

import { CUSTOMER_CREDITS_ACCOUNT } from '@/lib/accounting/liability-accounts'

export type AccountChoice = { code: string; name: string }

const label = (a: AccountChoice) => `${a.code} - ${a.name}`

function pick(choices: AccountChoice[], existingCodes: Iterable<string>): AccountChoice & { label: string } {
  const have = new Set([...existingCodes].map(c => String(c).trim()))
  const found = choices.find(a => have.has(a.code)) ?? choices[choices.length - 1]
  return { ...found, label: label(found) }
}

/** Stock given away is an expense at what it cost us. */
export const DONATION_ACCOUNTS: AccountChoice[] = [
  { code: '6514', name: 'Gifts and Donations' },
  { code: '6599', name: 'Other Operating Expenses' },
]
export const donationAccount = (codes: Iterable<string>) => pick(DONATION_ACCOUNTS, codes)

/** What a marketplace keeps out of a settlement is a selling cost. */
export const MARKETPLACE_FEE_ACCOUNTS: AccountChoice[] = [
  { code: '6403', name: 'Agent Commissions' },
  { code: '6401', name: 'Selling and Delivery' },
  { code: '6599', name: 'Other Operating Expenses' },
]
export const marketplaceFeeAccount = (codes: Iterable<string>) => pick(MARKETPLACE_FEE_ACCOUNTS, codes)

export const INVENTORY_ACCOUNT = '1200 - Inventory'
export const RECEIVABLES_ACCOUNT = '1800 - Accounts Receivable (Products)'

export type PlainLine = { account: string; description: string; debit: number; credit: number }

const round = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Giving stock away: the expense takes the value, inventory gives it up. Each
 * line is valued at what the unit cost us, never at what we would have sold it
 * for — a donation is not a sale.
 */
export function donationOutJournalLines(input: {
  donationRef: string
  party: string
  expenseAccount: string
  lines: Array<{ productName: string; qty: number; unitCost: number; inventoryAccount?: string }>
}): PlainLine[] {
  const out: PlainLine[] = []
  for (const line of input.lines) {
    const value = round(line.qty * line.unitCost)
    if (!(value > 0)) continue
    const what = `${line.productName} x${line.qty} donated to ${input.party} (${input.donationRef})`
    out.push({ account: input.expenseAccount, description: what, debit: value, credit: 0 })
    out.push({ account: line.inventoryAccount || INVENTORY_ACCOUNT, description: what, debit: 0, credit: value })
  }
  return out
}

/**
 * A marketplace week: they collected the gross from buyers, kept their cut and
 * paid us the rest. The receivable those orders raised is cleared in full, the
 * cut becomes an expense, and only the net reaches the bank.
 */
export function marketplaceSettlementJournalLines(input: {
  settlementRef: string
  period: string
  gross: number
  deductions: number
  netPaid: number
  bankAccount: string
  feeAccount: string
  receivableAccount?: string
}): PlainLine[] {
  const gross = round(input.gross)
  const deductions = round(input.deductions)
  const net = round(input.netPaid)
  if (!(gross > 0)) return []
  const what = `${input.settlementRef} — ${input.period}`
  const lines: PlainLine[] = [
    { account: input.bankAccount, description: `Settlement received, ${what}`, debit: net, credit: 0 },
  ]
  if (deductions > 0) {
    lines.push({ account: input.feeAccount, description: `Marketplace deductions, ${what}`, debit: deductions, credit: 0 })
  }
  lines.push({
    account: input.receivableAccount || RECEIVABLES_ACCOUNT,
    description: `Orders settled, ${what}`,
    debit: 0,
    credit: round(net + deductions),
  })
  return lines
}

export const SALES_RETURNS_ACCOUNT = '5099 - Sales Returns & Refunds'
export const PRODUCT_SALES_ACCOUNT = '5000 - Sales — Products (Invoices)'

/**
 * An exchange where the customer hands back more than they take: the balance
 * becomes store credit, the same way a trade-in settled as credit does.
 */
export function exchangeCreditJournalLines(input: {
  exchangeRef: string
  creditRef: string
  customerName: string
  amount: number
}): PlainLine[] {
  const amount = round(input.amount)
  if (!(amount > 0)) return []
  return [
    { account: SALES_RETURNS_ACCOUNT, description: `Exchange ${input.exchangeRef} balance owed to ${input.customerName}`, debit: amount, credit: 0 },
    { account: CUSTOMER_CREDITS_ACCOUNT, description: `Store credit ${input.creditRef}: ${input.customerName}`, debit: 0, credit: amount },
  ]
}

/**
 * An exchange is only even when both sides are worth the same. What is left
 * over is ordinary trade: the customer owes us, or we owe them.
 */
export function exchangeSettlement(priceDiff: number): { owed: 'customer' | 'us' | 'nobody'; amount: number } {
  const diff = round(priceDiff)
  if (diff > 0) return { owed: 'customer', amount: diff }
  if (diff < 0) return { owed: 'us', amount: Math.abs(diff) }
  return { owed: 'nobody', amount: 0 }
}
