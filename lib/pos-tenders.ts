/**
 * How a POS sale was paid: one method, or split across several (e.g. KES 5,000
 * cash and the rest by bank transfer). Every screen that totals tills, posts
 * the journal or prints the receipt reads the tenders through here, so a
 * split sale lands in the right drawer and the right bank.
 *
 * Pure.
 */
import { isPosBankPayment } from '@/lib/pos-session'

export type PosTenderMethod = 'cash' | 'mpesa' | 'bank'

export interface PosTender {
  method: PosTenderMethod
  amount: number
  /** Company bank account for a bank tender. */
  bankAccountId?: string
  /** Transfer reference or M-Pesa receipt. */
  reference?: string
}

type OrderLike = {
  total: number
  payment?: string
  bankAccountId?: string
  paymentReference?: string
  customerCreditAmount?: number
  splitPayments?: PosTender[]
}

export const MAX_SPLIT_TENDERS = 4

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

/** What the customer paid in cash/M-Pesa/bank (the total less client credit). */
export function posTenderTotal(order: Pick<OrderLike, 'total' | 'customerCreditAmount'>): number {
  return Math.max(0, money(order.total) - money(order.customerCreditAmount))
}

function normMethod(m?: string): PosTenderMethod | null {
  if (m === 'cash' || m === 'mpesa') return m
  if (isPosBankPayment(m)) return 'bank'
  return null
}

/** The sale's tenders: its split, or its single method for the whole amount. */
export function posTenders(order: OrderLike): PosTender[] {
  if (Array.isArray(order.splitPayments) && order.splitPayments.length) {
    return order.splitPayments
      .filter(t => normMethod(t.method) && money(t.amount) > 0)
      .map(t => ({ ...t, method: normMethod(t.method)!, amount: money(t.amount) }))
  }
  const method = normMethod(order.payment)
  const amount = posTenderTotal(order)
  if (!method || amount <= 0) return []
  return [{
    method,
    amount,
    ...(method === 'bank' && order.bankAccountId ? { bankAccountId: order.bankAccountId } : {}),
    ...(order.paymentReference ? { reference: order.paymentReference } : {}),
  }]
}

/** Cash, M-Pesa and bank totals over a set of sales (split sales counted per part). */
export function tenderTotalsByMethod(orders: OrderLike[]): { cash: number; mpesa: number; bank: number } {
  const out = { cash: 0, mpesa: 0, bank: 0 }
  for (const o of orders) for (const t of posTenders(o)) out[t.method] = money(out[t.method] + t.amount)
  return out
}

/** Bank tenders by account (for the session's bank summary). */
export function bankTendersByAccount(orders: OrderLike[], fallbackId: (method: string) => string): Map<string, number> {
  const out = new Map<string, number>()
  for (const o of orders) {
    for (const t of posTenders(o)) {
      if (t.method !== 'bank') continue
      const id = t.bankAccountId || fallbackId('bank')
      out.set(id, money((out.get(id) || 0) + t.amount))
    }
  }
  return out
}

export const TENDER_LABEL: Record<PosTenderMethod, string> = { cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank' }

/** "Cash 5,000 + Bank 20,000" — or just "Cash" for a single tender. */
export function tendersLabel(order: OrderLike, fmt: (n: number) => string = n => n.toLocaleString('en-KE')): string {
  const ts = posTenders(order)
  if (ts.length <= 1) return ts[0] ? TENDER_LABEL[ts[0].method] : ''
  return ts.map(t => `${TENDER_LABEL[t.method]} ${fmt(t.amount)}`).join(' + ')
}

/** The method that took the largest part (the order's headline payment). */
export function primaryTenderMethod(tenders: PosTender[]): PosTenderMethod | null {
  if (!tenders.length) return null
  return [...tenders].sort((a, b) => b.amount - a.amount)[0].method
}

/**
 * Check a split before charging. `due` is what the tenders must add up to.
 * Returns the first problem, or null.
 */
export function splitProblem(tenders: PosTender[], due: number): string | null {
  if (tenders.length < 2) return 'A split needs at least two parts'
  if (tenders.length > MAX_SPLIT_TENDERS) return `At most ${MAX_SPLIT_TENDERS} parts`
  for (const t of tenders) {
    if (!normMethod(t.method)) return 'Choose how each part is paid'
    if (!(money(t.amount) > 0)) return 'Every part needs an amount above zero'
    if (t.method === 'bank' && !t.bankAccountId) return 'Choose the bank account for the bank part'
  }
  const sum = money(tenders.reduce((a, t) => a + money(t.amount), 0))
  const diff = money(sum - money(due))
  if (Math.abs(diff) > 0.5) {
    return diff < 0 ? `Parts add up to ${sum.toLocaleString('en-KE')}: ${Math.abs(diff).toLocaleString('en-KE')} still to collect` : `Parts add up to ${sum.toLocaleString('en-KE')}: ${diff.toLocaleString('en-KE')} more than due`
  }
  if (tenders.filter(t => t.method === 'mpesa').length > 1) return 'Only one M-Pesa part per sale'
  return null
}

/**
 * The amounts typed on the till, with a blank last part taking whatever is
 * left: 5,000 cash + (blank) bank on a 25,000 sale → bank 20,000.
 */
export function fillLastTender(rows: Array<Omit<PosTender, 'amount'> & { amount: number | null }>, due: number): PosTender[] {
  const typed = rows.slice(0, -1).reduce((a, r) => a + money(r.amount), 0)
  return rows.map((r, i) => ({
    ...r,
    amount: i === rows.length - 1 && (r.amount == null || r.amount === 0) ? money(Math.max(0, money(due) - typed)) : money(r.amount),
  }))
}
