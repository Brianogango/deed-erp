import 'server-only'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { ensureTemplateAccounts } from '@/lib/accounting/ensure-template-accounts'
import { labelForRole } from '@/lib/accounting/coa-roles'
import {
  AGENT_TAG,
  DEFAULT_AGENT_SETTINGS,
  checkManualCommission,
  nextManualCommissionRef,
  commissionJournalLines,
  evaluateAgentSales,
  payoutJournalLines,
  planAgentPayout,
  reconcileAgentCommissions,
  type AgentCommission,
  type AgentPayout,
  type AgentSettings,
} from '@/lib/agents/agent-commissions'

export const AGENT_COMMISSIONS_KEY = 'deed_agentCommissions'
const AGENT_PAYOUTS_KEY = 'deed_agentPayouts'
export const AGENT_SETTINGS_KEY = 'deed_agentSettings'
/** Agent per sale order (sale orders are rebuilt from Prisma, which has no agent columns). */
export const SALE_AGENTS_KEY = 'deed_saleAgents'

export type SaleAgent = {
  saleOrderId: string
  agentId: string
  agentName: string
  agentCommission: number
  setById: string
  setByName: string
  setAt: string
}

/** Sale orders with their agent from deed_saleAgents laid over them. */
function withSaleAgents(saleOrders: unknown, saleAgents: unknown): Array<Record<string, unknown>> {
  const agents = new Map(asArray<SaleAgent>(saleAgents).map(a => [a.saleOrderId, a]))
  return asArray<Record<string, unknown>>(saleOrders).map(so => {
    const a = agents.get(String(so?.id))
    return a ? { ...so, agentId: a.agentId, agentName: a.agentName, agentCommission: a.agentCommission } : so
  })
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : [])

export function readAgentSettings(value: unknown): AgentSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<AgentSettings>
  return {
    withholdingEnabled: v.withholdingEnabled === true,
    withholdingRate: Number.isFinite(Number(v.withholdingRate)) && Number(v.withholdingRate) > 0 ? Number(v.withholdingRate) : DEFAULT_AGENT_SETTINGS.withholdingRate,
  }
}

/**
 * Bring commission rows in line with the sales and post the journals that
 * implies. A row changes status only once its journal posts; a journal that
 * cannot post (closed period, missing account) leaves the row as it was,
 * flagged, and is retried on the next sync. Idempotent: journal refs are
 * fixed per sale, and a rerun with nothing new changes nothing.
 */
export async function syncAgentCommissions(): Promise<{ rows: AgentCommission[]; posted: number; failed: number }> {
  return withAppStateKeyLock(AGENT_COMMISSIONS_KEY, async () => {
    const state = await loadAppStateForWrite(['deed_saleOrders', SALE_AGENTS_KEY, 'deed_posOrders', 'deed_invoices', AGENT_COMMISSIONS_KEY])
    const existing = asArray<AgentCommission>(state[AGENT_COMMISSIONS_KEY])
    const now = new Date().toISOString()
    const evaluated = evaluateAgentSales({
      saleOrders: withSaleAgents(state.deed_saleOrders, state[SALE_AGENTS_KEY]),
      posOrders: asArray(state.deed_posOrders),
      invoices: asArray(state.deed_invoices),
      today: now.slice(0, 10),
    })
    const { rows: planned, journals } = reconcileAgentCommissions({ existing, evaluated, now })
    let rows = planned
    let posted = 0
    let failed = 0
    if (journals.length) await ensureTemplateAccounts(['6403', '3314'])
    for (const intent of journals) {
      try {
        await createJournalEntry({
          ref: intent.ref,
          journalCode: 'GEN',
          date: intent.date,
          description: intent.kind === 'earn'
            ? `Agent commission ${intent.sourceRef} — ${intent.agentName}`
            : intent.kind === 'reverse'
              ? `Agent commission reversed ${intent.sourceRef} — ${intent.agentName}`
              : `Agent commission recoverable ${intent.sourceRef} — ${intent.agentName}`,
          sourceType: 'agent_commission',
          sourceId: intent.commissionId,
          skipIfExists: true,
          lines: commissionJournalLines(intent),
        })
        rows = intent.afterJournal(rows)
        posted += 1
      } catch (err) {
        failed += 1
        const reason = err instanceof Error ? err.message : 'could not post'
        rows = rows.map(r => (r.id === intent.commissionId ? { ...r, flag: `Journal not posted: ${reason}` } : r))
      }
    }
    if (JSON.stringify(rows) !== JSON.stringify(existing)) {
      await saveStoreKeys({ [AGENT_COMMISSIONS_KEY]: JSON.stringify(rows) })
    }
    return { rows, posted, failed }
  })
}

async function payoutAccountLabel(method: AgentPayout['method'], bankAccountCode?: string): Promise<string> {
  if (!bankAccountCode) return labelForRole(method === 'bank' ? 'bank_absa' : 'cash_mobile')
  const account = await prisma.accountCode.findUnique({ where: { code: bankAccountCode }, select: { code: true, name: true, accountType: true, isActive: true } })
  if (!account || !account.isActive || account.accountType !== 'asset') {
    const err = new Error(`Account ${bankAccountCode} is not an active bank/cash account`)
    ;(err as Error & { status?: number }).status = 422
    throw err
  }
  return `${account.code} - ${account.name}`
}

/** Pay an agent the chosen due lines: one journal, the lines marked paid. */
export async function recordAgentPayout(params: {
  agentId: string
  commissionIds: string[]
  method: AgentPayout['method']
  reference: string
  paidAt: string
  bankAccountCode?: string
  paidBy: { id: string; name: string }
}): Promise<AgentPayout> {
  // Bring statuses up to date first, so a just-refunded sale is not paid.
  await syncAgentCommissions()
  return withAppStateKeyLock(AGENT_COMMISSIONS_KEY, async () => {
    const state = await loadAppStateForWrite([AGENT_COMMISSIONS_KEY, AGENT_PAYOUTS_KEY, AGENT_SETTINGS_KEY])
    const rows = asArray<AgentCommission>(state[AGENT_COMMISSIONS_KEY])
    const payouts = asArray<AgentPayout>(state[AGENT_PAYOUTS_KEY])
    const settings = readAgentSettings(state[AGENT_SETTINGS_KEY])
    const plan = planAgentPayout({ rows, agentId: params.agentId, commissionIds: params.commissionIds, settings })
    if (plan.error) {
      const err = new Error(plan.error)
      ;(err as Error & { status?: number }).status = 409
      throw err
    }
    const agentName = plan.lines[0]?.agentName || 'Agent'
    const ref = `AGP/${String(payouts.length + 1).padStart(4, '0')}`
    const journalRef = `JRN/${ref}`
    await ensureTemplateAccounts(plan.withholdingTax > 0 ? ['3314', '3307'] : ['3314'])
    const bankLabel = await payoutAccountLabel(params.method, params.bankAccountCode)
    await createJournalEntry({
      ref: journalRef,
      journalCode: params.method === 'bank' ? 'BNK' : 'CSH',
      date: params.paidAt,
      description: `Agent payout ${ref} — ${agentName}${params.reference ? ` (${params.reference})` : ''}`,
      sourceType: 'agent_payout',
      sourceId: ref,
      createdById: params.paidBy.id,
      skipIfExists: false,
      lines: payoutJournalLines({ gross: plan.gross, withholdingTax: plan.withholdingTax, net: plan.net, bankLabel, agentName, ref }),
    })
    const payout: AgentPayout = {
      id: randomUUID(),
      ref,
      agentId: params.agentId,
      agentName,
      commissionIds: plan.lines.map(l => l.id),
      gross: plan.gross,
      withholdingTax: plan.withholdingTax,
      net: plan.net,
      method: params.method,
      reference: params.reference,
      paidAt: params.paidAt,
      paidBy: params.paidBy.name,
      journalRef,
    }
    const paidIds = new Set(payout.commissionIds)
    const now = new Date().toISOString()
    const nextRows = rows.map(r => (paidIds.has(r.id) ? { ...r, status: 'paid' as const, payoutId: payout.id, paidAt: params.paidAt, updatedAt: now } : r))
    await saveStoreKeys({
      [AGENT_COMMISSIONS_KEY]: JSON.stringify(nextRows),
      [AGENT_PAYOUTS_KEY]: JSON.stringify([...payouts, payout]),
    })
    return payout
  })
}

export async function loadAgentOverview() {
  const { rows } = await syncAgentCommissions()
  const state = await loadAppState([AGENT_PAYOUTS_KEY, AGENT_SETTINGS_KEY])
  const agents = await prisma.client.findMany({
    where: { tags: { array_contains: [AGENT_TAG] } },
    select: { id: true, name: true, phone: true, email: true, kraPin: true },
    orderBy: { name: 'asc' },
  }).catch(() => [] as Array<{ id: string; name: string; phone: string | null; email: string | null; kraPin: string | null }>)
  return {
    agents,
    commissions: rows,
    payouts: asArray<AgentPayout>(state[AGENT_PAYOUTS_KEY]),
    settings: readAgentSettings(state[AGENT_SETTINGS_KEY]),
  }
}

function httpError(message: string, status: number) {
  const err = new Error(message)
  ;(err as Error & { status?: number }).status = status
  return err
}

/**
 * Raise a commission bill by hand: the agent is owed it at once
 * (Dr 6403 / Cr 3314) and it is paid with their next payout.
 */
export async function addManualCommission(params: {
  agentId: string
  amount: number
  date: string
  saleRef?: string
  customerName?: string
  saleTotal?: number
  description?: string
  attachment?: AgentCommission['attachment']
  createdBy: { id: string; name: string }
}): Promise<AgentCommission> {
  const agent = await prisma.client.findFirst({
    where: { id: params.agentId, tags: { array_contains: [AGENT_TAG] } },
    select: { id: true, name: true },
  })
  if (!agent) throw httpError('Choose a Deed Express agent (add them under Add agent first)', 422)
  return withAppStateKeyLock(AGENT_COMMISSIONS_KEY, async () => {
    const state = await loadAppStateForWrite([AGENT_COMMISSIONS_KEY])
    const rows = asArray<AgentCommission>(state[AGENT_COMMISSIONS_KEY])
    const problem = checkManualCommission(rows, { agentId: agent.id, amount: params.amount, saleRef: params.saleRef, date: params.date })
    if (problem) throw httpError(problem, 409)
    const id = nextManualCommissionRef(rows)
    const amount = Math.round(params.amount * 100) / 100
    const sourceRef = params.saleRef?.trim() || id
    const journalRef = `JRN/${id}`
    await ensureTemplateAccounts(['6403', '3314'])
    await createJournalEntry({
      ref: journalRef,
      journalCode: 'GEN',
      date: params.date,
      description: `Agent commission bill ${id} — ${agent.name}${params.description ? ` — ${params.description}` : ''}`,
      sourceType: 'agent_commission',
      sourceId: id,
      createdById: params.createdBy.id,
      skipIfExists: false,
      lines: commissionJournalLines({ kind: 'earn', ref: journalRef, date: params.date, commissionId: id, agentName: agent.name, sourceRef, amount }),
    })
    const now = new Date().toISOString()
    const row: AgentCommission = {
      id,
      sourceKind: 'manual',
      sourceId: id,
      sourceRef,
      agentId: agent.id,
      agentName: agent.name,
      customerName: params.customerName?.trim() || '',
      saleTotal: Math.max(0, Number(params.saleTotal) || 0),
      amount,
      status: 'due',
      earnedAt: params.date,
      journalRef,
      description: params.description?.trim() || undefined,
      createdByName: params.createdBy.name,
      attachment: params.attachment,
      createdAt: now,
      updatedAt: now,
    }
    await saveStoreKeys({ [AGENT_COMMISSIONS_KEY]: JSON.stringify([...rows, row]) })
    return row
  })
}

/** Cancel a manual commission bill that has not been paid: its journal is reversed. */
export async function cancelManualCommission(id: string, by: { id: string; name: string }): Promise<AgentCommission> {
  return withAppStateKeyLock(AGENT_COMMISSIONS_KEY, async () => {
    const state = await loadAppStateForWrite([AGENT_COMMISSIONS_KEY])
    const rows = asArray<AgentCommission>(state[AGENT_COMMISSIONS_KEY])
    const row = rows.find(r => r.id === id)
    if (!row || row.sourceKind !== 'manual') throw httpError('Commission bill not found', 404)
    if (row.status !== 'due') throw httpError(row.status === 'paid' ? 'Already paid — it cannot be cancelled' : 'Already cancelled', 409)
    const today = new Date().toISOString().slice(0, 10)
    const ref = `JRN/${id}-REV`
    await createJournalEntry({
      ref,
      journalCode: 'GEN',
      date: today,
      description: `Agent commission bill ${id} cancelled — ${row.agentName}`,
      sourceType: 'agent_commission',
      sourceId: id,
      createdById: by.id,
      skipIfExists: true,
      lines: commissionJournalLines({ kind: 'reverse', ref, date: today, commissionId: id, agentName: row.agentName, sourceRef: row.sourceRef, amount: row.amount }),
    })
    const next: AgentCommission = { ...row, status: 'cancelled', flag: `Cancelled by ${by.name}`, updatedAt: new Date().toISOString() }
    await saveStoreKeys({ [AGENT_COMMISSIONS_KEY]: JSON.stringify(rows.map(r => (r.id === id ? next : r))) })
    return next
  })
}

/** The commission row a manual-bill attachment belongs to. */
export async function findCommission(id: string): Promise<AgentCommission | undefined> {
  const state = await loadAppState([AGENT_COMMISSIONS_KEY])
  return asArray<AgentCommission>(state[AGENT_COMMISSIONS_KEY]).find(r => r.id === id)
}
