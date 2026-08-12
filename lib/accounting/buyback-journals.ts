/**
 * Buy-back / trade-in GL builders (Finance Phase 12).
 * Pure helpers — callers persist via posting engine or journal dual-write.
 *
 * Flow:
 * 1. Payout: Dr trade-in clearing / Cr cash
 * 2. Stock-in: Dr inventory / Cr trade-in clearing
 */

import {
  cashAccountRoleForMethod,
  labelForRole,
  type CoaRole,
} from '@/lib/accounting/coa-roles'
import { roundMoney } from '@/lib/accounting/money'

export type BuyBackLineLike = {
  productId?: string
  productName?: string
  qty: number
  unitPrice: number
  serialIds?: string[]
}

export type BuyBackLike = {
  id: string
  ref: string
  customerName: string
  total: number
  paymentMethod?: string | null
  lines: BuyBackLineLike[]
}

export type BuyBackJournalLine = {
  role?: CoaRole
  accountLabel: string
  description: string
  debit: number
  credit: number
}

export function buyBackPayoutRef(bbRef: string): string {
  return `JRN/BBK/PAY/${bbRef}`.slice(0, 80)
}

export function buyBackStockRef(bbRef: string): string {
  return `JRN/BBK/STK/${bbRef}`.slice(0, 80)
}

export function buildBuyBackPayoutLines(
  bb: BuyBackLike,
  paymentMethod?: string | null,
): BuyBackJournalLine[] {
  const amount = roundMoney(Number(bb.total) || 0)
  if (amount <= 0) return []
  const cashRole = cashAccountRoleForMethod(paymentMethod || bb.paymentMethod || 'cash')
  return [
    {
      role: 'trade_in_clearing',
      accountLabel: labelForRole('trade_in_clearing'),
      description: `Trade-in payout ${bb.ref} — ${bb.customerName}`,
      debit: amount,
      credit: 0,
    },
    {
      role: cashRole,
      accountLabel: labelForRole(cashRole),
      description: `Paid ${bb.customerName} for ${bb.ref}`,
      debit: 0,
      credit: amount,
    },
  ]
}

export function buildBuyBackStockLines(bb: BuyBackLike): BuyBackJournalLine[] {
  const amount = roundMoney(
    bb.lines.reduce((s, l) => s + Number(l.unitPrice || 0) * Number(l.qty || 0), 0)
    || Number(bb.total)
    || 0,
  )
  if (amount <= 0) return []
  return [
    {
      role: 'inventory',
      accountLabel: labelForRole('inventory'),
      description: `Trade-in stock-in ${bb.ref}`,
      debit: amount,
      credit: 0,
    },
    {
      role: 'trade_in_clearing',
      accountLabel: labelForRole('trade_in_clearing'),
      description: `Clear trade-in ${bb.ref}`,
      debit: 0,
      credit: amount,
    },
  ]
}

export function assertBuyBackLinesBalanced(lines: BuyBackJournalLine[], ref?: string) {
  const debit = roundMoney(lines.reduce((s, l) => s + Number(l.debit || 0), 0))
  const credit = roundMoney(lines.reduce((s, l) => s + Number(l.credit || 0), 0))
  if (Math.abs(debit - credit) > 0.02) {
    throw new Error(`Unbalanced buy-back journal${ref ? ` ${ref}` : ''}: debit=${debit} credit=${credit}`)
  }
}
