/**
 * Deed Express agents — independent individuals who bring customers.
 *
 * Each sale (a sale order, or a POS ticket) may name one agent and the
 * commission agreed for it in KES (there is no rate). The commission is
 * earned when the customer has paid the sale in full:
 *
 *   pending   customer has not paid in full — nothing owed, nothing booked
 *   due       paid in full: Dr 6403 Agent Commissions / Cr 3314 Payable
 *   paid      in a payout:  Dr 3314 / Cr bank (net) [/ Cr 3307 WHT]
 *   cancelled refunded or agent removed before payout: the accrual reversed
 *
 * A refund after payout claws the commission back: a negative "due" line
 * (Dr 3314 / Cr 6403) that the agent's next payout deducts. A partial refund
 * is flagged for Finance instead of guessed at.
 *
 * Finance can also raise a commission bill by hand (sourceKind 'manual') for
 * an agent whose sale is not in the system or was agreed separately: it is
 * due at once (Dr 6403 / Cr 3314), paid through the same payout, and can be
 * cancelled (journal reversed) until it is paid. The sync never touches it.
 *
 * Pure — the server sync (agent-commissions.server.ts) loads the lists,
 * posts the journals this returns and saves the rows.
 */

export const AGENT_TAG = 'deed_express_agent'
export const AGENT_COMMISSION_EXPENSE = '6403 - Agent Commissions'
export const AGENT_COMMISSIONS_PAYABLE = '3314 - Agent Commissions Payable'
export const WITHHOLDING_TAX_PAYABLE = '3307 - Withholding Tax Payable'

export type CommissionStatus = 'pending' | 'due' | 'paid' | 'cancelled'

export type AgentCommission = {
  id: string
  sourceKind: 'sale_order' | 'pos_order' | 'manual'
  sourceId: string
  sourceRef: string
  agentId: string
  agentName: string
  customerName: string
  saleTotal: number
  /** Positive commission; negative for a clawback line. */
  amount: number
  status: CommissionStatus
  /** Set on clawback lines: the paid commission being recovered. */
  clawbackOf?: string
  earnedAt?: string
  paidAt?: string
  payoutId?: string
  journalRef?: string
  /**
   * How many times the commission has been booked. A payment reversed after
   * the commission fell due takes it back to pending; earning it again needs
   * a journal ref of its own.
   */
  accruals?: number
  /** Manual bills: what the commission is for. */
  description?: string
  createdByName?: string
  /** Optional document behind a manual bill (the agent's invoice, a receipt…). */
  attachment?: { name: string; size: number; contentType: string; objectKey: string; uploadedAt: string }
  /** Shown to Finance: partial refund, period locked, … */
  flag?: string
  createdAt: string
  updatedAt: string
}

export type AgentPayout = {
  id: string
  ref: string
  agentId: string
  agentName: string
  commissionIds: string[]
  gross: number
  withholdingTax: number
  net: number
  method: 'mpesa' | 'bank' | 'cash'
  reference: string
  paidAt: string
  paidBy: string
  journalRef: string
}

export type AgentSettings = { withholdingEnabled: boolean; withholdingRate: number }
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { withholdingEnabled: false, withholdingRate: 5 }

type Row = Record<string, any>
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100
const CLOSED = new Set(['cancelled', 'canceled', 'voided', 'void'])

export type EvaluatedSale = {
  id: string
  sourceKind: 'sale_order' | 'pos_order'
  sourceId: string
  sourceRef: string
  agentId: string
  agentName: string
  amount: number
  customerName: string
  saleTotal: number
  state: 'pending' | 'earned' | 'void'
  earnedAt?: string
  /** Partly refunded — leave the commission as it is and tell Finance. */
  partlyRefunded?: boolean
}

export function commissionIdFor(kind: 'sale_order' | 'pos_order', sourceId: string) {
  return `${kind}:${sourceId}`
}

/** Paid / credited totals over the invoices that settle one sale. */
function settlement(invoiceIds: Set<string>, invoices: Row[]) {
  const live = invoices.filter(i => invoiceIds.has(String(i.id)) && !i.isCreditNote && Number(i.total) > 0
    && !CLOSED.has(String(i.status)) && String(i.status) !== 'draft')
  const paid = live.reduce((s, i) => s + Math.min(money(i.amountPaid), money(i.total)), 0)
  const credited = invoices
    .filter(i => (i.isCreditNote || Number(i.total) < 0) && invoiceIds.has(String(i.sourceInvoiceId)) && !CLOSED.has(String(i.status)))
    .reduce((s, i) => s + Math.abs(money(i.total)), 0)
  const lastPaid = live
    .map(i => String(i.paidDate || i.paymentDate || i.lastPaymentDate || i.updatedAt || i.date || ''))
    .filter(Boolean)
    .sort()
    .at(-1)
  return { live, paid, credited, lastPaid }
}

/** Every sale that names an agent, and whether its commission is earned. */
export function evaluateAgentSales(input: { saleOrders: Row[]; posOrders: Row[]; invoices: Row[]; today: string }): EvaluatedSale[] {
  const out: EvaluatedSale[] = []
  for (const so of input.saleOrders) {
    if (!so?.agentId || !(money(so.agentCommission) > 0)) continue
    const total = money(so.total)
    const ids = new Set(input.invoices.filter(i => i.saleOrderId === so.id).map(i => String(i.id)))
    const { live, paid, credited, lastPaid } = settlement(ids, input.invoices)
    const refunded = total > 0 && credited >= total - 1
    const state: EvaluatedSale['state'] = CLOSED.has(String(so.status)) || refunded
      ? 'void'
      : live.length > 0 && total > 0 && paid >= total - 1 ? 'earned' : 'pending'
    out.push({
      id: commissionIdFor('sale_order', String(so.id)),
      sourceKind: 'sale_order',
      sourceId: String(so.id),
      sourceRef: String(so.ref || so.orderNumber || so.id),
      agentId: String(so.agentId),
      agentName: String(so.agentName || ''),
      amount: money(so.agentCommission),
      customerName: String(so.customerName || ''),
      saleTotal: total,
      state,
      earnedAt: state === 'earned' ? (lastPaid || input.today).slice(0, 10) : undefined,
      partlyRefunded: credited > 0 && !refunded,
    })
  }
  for (const po of input.posOrders) {
    if (!po?.agentId || !(money(po.agentCommission) > 0)) continue
    const total = money(po.total)
    // A POS ticket is paid at the till; its invoice carries any refund.
    const ids = new Set(po.invoiceId ? [String(po.invoiceId)] : [])
    const { live, paid, credited } = settlement(ids, input.invoices)
    const refunded = total > 0 && credited >= total - 1
    const paidInFull = !po.invoiceId || (live.length > 0 && paid >= total - 1)
    const state: EvaluatedSale['state'] = CLOSED.has(String(po.status)) || refunded ? 'void' : paidInFull ? 'earned' : 'pending'
    out.push({
      id: commissionIdFor('pos_order', String(po.id)),
      sourceKind: 'pos_order',
      sourceId: String(po.id),
      sourceRef: String(po.ref || po.id),
      agentId: String(po.agentId),
      agentName: String(po.agentName || ''),
      amount: money(po.agentCommission),
      customerName: String(po.customerName || ''),
      saleTotal: total,
      state,
      earnedAt: state === 'earned' ? String(po.date || po.createdAt || input.today).slice(0, 10) : undefined,
      partlyRefunded: credited > 0 && !refunded,
    })
  }
  return out
}

export type JournalIntent = {
  kind: 'earn' | 'reverse' | 'clawback'
  ref: string
  date: string
  commissionId: string
  agentName: string
  sourceRef: string
  amount: number
}

const jref = (prefix: string, sourceRef: string, n = 0) => `${prefix}/${sourceRef}${n ? `/${n}` : ''}`.slice(0, 80)

/**
 * Bring the commission rows in line with the sales. Returns the rows to
 * store and the journals to post; a row moves to its new status only once
 * its journal posts (the caller applies `afterJournal` on success).
 */
export function reconcileAgentCommissions(params: {
  existing: AgentCommission[]
  evaluated: EvaluatedSale[]
  now: string
}): { rows: AgentCommission[]; journals: Array<JournalIntent & { afterJournal: (rows: AgentCommission[]) => AgentCommission[] }> } {
  const today = params.now.slice(0, 10)
  const byId = new Map(params.existing.map(r => [r.id, r]))
  const seen = new Set<string>()
  let rows = [...params.existing]
  const journals: Array<JournalIntent & { afterJournal: (rows: AgentCommission[]) => AgentCommission[] }> = []
  const replace = (list: AgentCommission[], id: string, patch: Partial<AgentCommission>) =>
    list.map(r => (r.id === id ? { ...r, ...patch, updatedAt: params.now } : r))
  const clawbacksOf = (id: string) => params.existing.filter(r => r.clawbackOf === id).length

  const settle = (row: AgentCommission, nextState: 'pending' | 'earned' | 'void', ev?: EvaluatedSale) => {
    if (row.status === 'pending') {
      if (nextState === 'earned' && ev) {
        const n = row.accruals ?? 0
        const ref = jref('JRN/AGC', row.sourceRef, n)
        journals.push({
          kind: 'earn', ref, date: ev.earnedAt ?? today, commissionId: row.id, agentName: row.agentName, sourceRef: row.sourceRef, amount: row.amount,
          afterJournal: list => replace(list, row.id, { status: 'due', earnedAt: ev.earnedAt ?? today, journalRef: ref, accruals: n + 1, flag: undefined }),
        })
      } else if (nextState === 'void') {
        rows = replace(rows, row.id, { status: 'cancelled' })
      }
      return
    }
    if (row.status === 'due' && nextState === 'void' && !row.clawbackOf) {
      const ref = jref('JRN/AGC-REV', row.sourceRef, (row.accruals ?? 1) - 1)
      journals.push({
        kind: 'reverse', ref, date: today, commissionId: row.id, agentName: row.agentName, sourceRef: row.sourceRef, amount: row.amount,
        afterJournal: list => replace(list, row.id, { status: 'cancelled', accruals: row.accruals ?? 1 }),
      })
      return
    }
    // Due, then the customer's payment was reversed: not earned after all —
    // back to waiting for payment, the accrual reversed.
    if (row.status === 'due' && nextState === 'pending' && !row.clawbackOf) {
      const ref = jref('JRN/AGC-REV', row.sourceRef, (row.accruals ?? 1) - 1)
      journals.push({
        kind: 'reverse', ref, date: today, commissionId: row.id, agentName: row.agentName, sourceRef: row.sourceRef, amount: row.amount,
        afterJournal: list => replace(list, row.id, {
          status: 'pending', earnedAt: undefined, journalRef: undefined, accruals: row.accruals ?? 1,
          flag: 'Customer payment reversed — waiting for payment again',
        }),
      })
      return
    }
    if (row.status === 'paid' && nextState === 'void' && !row.clawbackOf) {
      // Already recovered (or being recovered)? One clawback per payment.
      if (params.existing.some(r => r.clawbackOf === row.id && r.status !== 'cancelled')) return
      const clawId = `${row.id}:clawback:${clawbacksOf(row.id) + 1}`
      const ref = jref('JRN/AGC-CLAW', row.sourceRef, clawbacksOf(row.id))
      journals.push({
        kind: 'clawback', ref, date: today, commissionId: clawId, agentName: row.agentName, sourceRef: row.sourceRef, amount: row.amount,
        afterJournal: list => [...list, {
          ...row,
          id: clawId,
          amount: -row.amount,
          status: 'due',
          clawbackOf: row.id,
          payoutId: undefined,
          paidAt: undefined,
          journalRef: ref,
          earnedAt: today,
          flag: 'Refunded after payout — deducted from the next payout',
          createdAt: params.now,
          updatedAt: params.now,
        }],
      })
    }
  }

  for (const ev of params.evaluated) {
    seen.add(ev.id)
    const row = byId.get(ev.id)
    if (!row) {
      if (ev.state === 'void') continue
      const fresh: AgentCommission = {
        id: ev.id, sourceKind: ev.sourceKind, sourceId: ev.sourceId, sourceRef: ev.sourceRef,
        agentId: ev.agentId, agentName: ev.agentName, customerName: ev.customerName, saleTotal: ev.saleTotal,
        amount: ev.amount, status: 'pending', createdAt: params.now, updatedAt: params.now,
      }
      rows.push(fresh)
      settle(fresh, ev.state, ev)
      continue
    }
    if (row.status === 'pending') {
      // Until it is earned the sale may still change its agent or amount.
      rows = replace(rows, row.id, {
        agentId: ev.agentId, agentName: ev.agentName, amount: ev.amount,
        customerName: ev.customerName, saleTotal: ev.saleTotal,
      })
      settle({ ...row, agentId: ev.agentId, agentName: ev.agentName, amount: ev.amount }, ev.state, ev)
      continue
    }
    if (row.status === 'cancelled' && ev.state !== 'void' && !row.clawbackOf) {
      // Re-sold or un-cancelled: start again from pending.
      const accruals = row.accruals ?? (row.journalRef ? 1 : 0)
      rows = replace(rows, row.id, { status: 'pending', journalRef: undefined, accruals, agentId: ev.agentId, agentName: ev.agentName, amount: ev.amount })
      settle({ ...row, status: 'pending', accruals, agentId: ev.agentId, agentName: ev.agentName, amount: ev.amount }, ev.state, ev)
      continue
    }
    if ((row.status === 'due' || row.status === 'paid') && !row.clawbackOf) {
      const changed = ev.agentId !== row.agentId || money(ev.amount) !== money(row.amount)
      const flag = ev.partlyRefunded
        ? 'Partly refunded — review whether the commission still stands'
        : row.status === 'paid' && ev.state === 'pending'
          ? 'Paid out, but the customer has not paid in full any more (payment reversed) — review'
          : changed ? 'Agent or amount changed after it was earned — not applied' : undefined
      if (flag !== row.flag && !(row.status === 'due' && ev.state === 'pending')) rows = replace(rows, row.id, { flag })
      settle(row, ev.state, ev)
    }
  }

  // Sales that no longer name an agent.
  for (const row of params.existing) {
    if (seen.has(row.id) || row.clawbackOf || row.sourceKind === 'manual') continue
    if (row.status === 'pending') rows = rows.filter(r => r.id !== row.id)
    else settle(row, 'void')
  }

  return { rows, journals }
}

/** Journal lines for one intent. */
export function commissionJournalLines(intent: JournalIntent): Array<{ accountLabel: string; label: string; debit: number; credit: number }> {
  const amount = money(intent.amount)
  const label = `${intent.agentName} — ${intent.sourceRef}`
  if (intent.kind === 'earn') {
    return [
      { accountLabel: AGENT_COMMISSION_EXPENSE, label: `Agent commission: ${label}`, debit: amount, credit: 0 },
      { accountLabel: AGENT_COMMISSIONS_PAYABLE, label: `Owed to ${label}`, debit: 0, credit: amount },
    ]
  }
  // reverse (before payout) and clawback (after payout) both undo the cost;
  // a clawback leaves the agent owing it until the next payout deducts it.
  return [
    { accountLabel: AGENT_COMMISSIONS_PAYABLE, label: `${intent.kind === 'clawback' ? 'Recoverable from' : 'No longer owed to'} ${label}`, debit: amount, credit: 0 },
    { accountLabel: AGENT_COMMISSION_EXPENSE, label: `Agent commission reversed: ${label}`, debit: 0, credit: amount },
  ]
}

/** What one payout pays: the chosen due lines (clawbacks included) net of withholding tax. */
export function planAgentPayout(params: {
  rows: AgentCommission[]
  agentId: string
  commissionIds: string[]
  settings: AgentSettings
}): { lines: AgentCommission[]; gross: number; withholdingTax: number; net: number; error?: string } {
  const chosen = new Set(params.commissionIds)
  const lines = params.rows.filter(r => chosen.has(r.id))
  if (lines.length !== chosen.size) return { lines, gross: 0, withholdingTax: 0, net: 0, error: 'Some lines no longer exist — refresh and try again' }
  const wrong = lines.find(r => r.agentId !== params.agentId || r.status !== 'due')
  if (wrong) return { lines, gross: 0, withholdingTax: 0, net: 0, error: `${wrong.sourceRef} is not due to this agent` }
  // Clawbacks owed by this agent are always deducted, chosen or not.
  const owed = params.rows.filter(r => r.agentId === params.agentId && r.status === 'due' && r.amount < 0 && !chosen.has(r.id))
  const all = [...lines, ...owed]
  const gross = money(all.reduce((s, r) => s + r.amount, 0))
  if (gross <= 0) return { lines: all, gross, withholdingTax: 0, net: 0, error: 'Nothing to pay: refunds owed by this agent cover these commissions' }
  const withholdingTax = params.settings.withholdingEnabled ? money(gross * (params.settings.withholdingRate / 100)) : 0
  return { lines: all, gross, withholdingTax, net: money(gross - withholdingTax) }
}

export function payoutJournalLines(params: { gross: number; withholdingTax: number; net: number; bankLabel: string; agentName: string; ref: string }) {
  return [
    { accountLabel: AGENT_COMMISSIONS_PAYABLE, label: `Payout ${params.ref} — ${params.agentName}`, debit: params.gross, credit: 0 },
    { accountLabel: params.bankLabel, label: `Paid to ${params.agentName} (${params.ref})`, debit: 0, credit: params.net },
    ...(params.withholdingTax > 0
      ? [{ accountLabel: WITHHOLDING_TAX_PAYABLE, label: `WHT on agent commission ${params.ref}`, debit: 0, credit: params.withholdingTax }]
      : []),
  ]
}

/** Next manual commission bill number: AGB/0001, AGB/0002, … */
export function nextManualCommissionRef(rows: AgentCommission[]): string {
  const n = rows
    .filter(r => r.sourceKind === 'manual')
    .reduce((max, r) => Math.max(max, Number(String(r.id).split('/').pop()) || 0), 0)
  return `AGB/${String(n + 1).padStart(4, '0')}`
}

/**
 * Check a manual commission bill before it is raised. A sale that already
 * carries this agent's commission (from the sale order or the till) would be
 * paid twice.
 */
export function checkManualCommission(rows: AgentCommission[], input: { agentId: string; amount: number; saleRef?: string; date: string }): string | null {
  if (!input.agentId) return 'Choose the agent'
  if (!(money(input.amount) > 0)) return 'Enter the commission amount'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Enter the bill date'
  const ref = String(input.saleRef ?? '').trim().toLowerCase()
  if (ref) {
    const dupe = rows.find(r => r.agentId === input.agentId && r.status !== 'cancelled' && !r.clawbackOf && r.sourceRef.trim().toLowerCase() === ref)
    if (dupe) return `${dupe.sourceRef} already has a commission for this agent (${dupe.status}) — it would be paid twice`
  }
  return null
}
