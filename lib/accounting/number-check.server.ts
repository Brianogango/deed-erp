import 'server-only'

import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'
import { repeatedRefs, returnsMissingValuation, valuationSkippedByRepeat } from '@/lib/doc-number-repair'

/**
 * What the old per-browser document numbers may have cost the books. Read
 * only: nothing is posted or renumbered here — finance decides.
 *
 * - The ledger keeps one journal per number and skips a repeat, so a refund
 *   or POS session close that repeated a number may never have reached it.
 * - The valuation skips a return number + product it has seen, so a
 *   repeated return may have moved stock without its value.
 */

type RefundPayment = { id: string; ref: string; rmaRef?: string; customerName?: string; amount?: number; paymentDate?: string; createdDate?: string; journalEntryId?: string }
type PosSession = { id: string; ref: string; formerRef?: string; status?: string; closedAt?: string; totalSales?: number }
type ReturnOrder = { id: string; ref: string; formerRef?: string; customerName?: string; receivedDate?: string; lines?: Array<{ productId: string; productName?: string; qty?: number }> }

export type NumberCheck = {
  refundRepeats: Array<{ ref: string; payments: Array<{ id: string; rmaRef?: string; customerName?: string; amount?: number; date?: string }> }>
  refundsNotInLedger: Array<{ id: string; ref: string; rmaRef?: string; customerName?: string; amount?: number; date?: string }>
  posSessionsNotInLedger: Array<{ id: string; ref: string; formerRef?: string; closedAt?: string; totalSales?: number }>
  returnsMissingValue: Array<{ id: string; ref: string; formerRef?: string; customerName?: string; products: string[] }>
}

export async function runNumberCheck(): Promise<NumberCheck> {
  const state = await loadAppState(['deed_refundPayments', 'deed_posSessions', 'deed_returnOrders'])
  const refunds = ((state.deed_refundPayments as RefundPayment[]) ?? []).filter(p => p && p.id)
  const sessions = ((state.deed_posSessions as PosSession[]) ?? []).filter(s => s && s.id)
  const returns = ((state.deed_returnOrders as ReturnOrder[]) ?? []).filter(r => r && r.id)

  const dateOf = (p: RefundPayment) => p.paymentDate || p.createdDate || ''
  const view = (p: RefundPayment) => ({ id: p.id, ref: p.ref, rmaRef: p.rmaRef, customerName: p.customerName, amount: p.amount, date: dateOf(p) })

  // A refund's journal reached the ledger when a ledger entry carries its id.
  const withJournal = refunds.filter(p => p.journalEntryId)
  const posted = withJournal.length
    ? new Set((await prisma.journalEntry.findMany({
        where: { blobId: { in: withJournal.map(p => String(p.journalEntryId)) } },
        select: { blobId: true },
      })).map(e => e.blobId))
    : new Set<string | null>()

  return {
    refundRepeats: repeatedRefs(refunds, dateOf).map(g => ({ ref: g.ref, payments: g.records.map(view) })),
    refundsNotInLedger: withJournal.filter(p => !posted.has(String(p.journalEntryId))).map(view),
    posSessionsNotInLedger: valuationSkippedByRepeat(sessions, {
      posted: s => s.status === 'closed',
      postedAt: s => s.closedAt || '',
      keysOf: s => [s.formerRef || s.ref],
    }).map(s => ({ id: s.id, ref: s.ref, formerRef: s.formerRef, closedAt: s.closedAt, totalSales: s.totalSales })),
    returnsMissingValue: returnsMissingValuation(returns.map(r => ({ ...r, lines: r.lines ?? [] }))).map(r => ({
      id: r.id, ref: r.ref, formerRef: r.formerRef, customerName: r.customerName,
      products: (r.lines ?? []).map(l => `${l.qty ?? ''} × ${l.productName ?? l.productId}`.trim()),
    })),
  }
}
