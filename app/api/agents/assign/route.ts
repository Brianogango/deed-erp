/**
 * The Deed Express agent on a sale order, kept in deed_saleAgents (sale
 * orders themselves are rebuilt from Prisma, which has no agent columns).
 *
 * GET ?saleOrderId= — the agent on that order, if any.
 * PUT { saleOrderId, agentId, agentCommission } — set or clear it. Locked
 *     once the commission is due or paid.
 */
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { AGENT_TAG, commissionIdFor, type AgentCommission } from '@/lib/agents/agent-commissions'
import { AGENT_COMMISSIONS_KEY, SALE_AGENTS_KEY, type SaleAgent } from '@/lib/agents/agent-commissions.server'

export const dynamic = 'force-dynamic'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const saleOrderId = new URL(request.url).searchParams.get('saleOrderId') ?? ''
    const state = await loadAppState([SALE_AGENTS_KEY])
    const rows = Array.isArray(state[SALE_AGENTS_KEY]) ? state[SALE_AGENTS_KEY] as SaleAgent[] : []
    return NextResponse.json({ agent: rows.find(r => r.saleOrderId === saleOrderId) ?? null }, { headers: { 'Cache-Control': 'private, no-store' } })
  })
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const saleOrderId = String(body.saleOrderId ?? '').trim()
    const agentId = String(body.agentId ?? '').trim()
    const agentCommission = Math.max(0, Math.round((Number(body.agentCommission) || 0) * 100) / 100)
    if (!saleOrderId) return NextResponse.json({ error: 'saleOrderId is required' }, { status: 422 })

    let agentName = ''
    if (agentId) {
      const agent = await prisma.client.findFirst({
        where: { id: agentId, tags: { array_contains: [AGENT_TAG] } },
        select: { name: true },
      })
      if (!agent) return NextResponse.json({ error: 'That contact is not a Deed Express agent' }, { status: 422 })
      agentName = agent.name
    }

    const agent = await withAppStateKeyLock(SALE_AGENTS_KEY, async () => {
      const state = await loadAppStateForWrite([SALE_AGENTS_KEY, AGENT_COMMISSIONS_KEY])
      const rows = Array.isArray(state[SALE_AGENTS_KEY]) ? state[SALE_AGENTS_KEY] as SaleAgent[] : []
      const commissions = Array.isArray(state[AGENT_COMMISSIONS_KEY]) ? state[AGENT_COMMISSIONS_KEY] as AgentCommission[] : []
      const line = commissions.find(c => c.id === commissionIdFor('sale_order', saleOrderId))
      if (line && (line.status === 'due' || line.status === 'paid')) {
        const err = new Error(`The agent commission on this sale is already ${line.status} — Finance must handle changes`)
        ;(err as Error & { status?: number }).status = 409
        throw err
      }
      const rest = rows.filter(r => r.saleOrderId !== saleOrderId)
      const next: SaleAgent | null = agentId
        ? { saleOrderId, agentId, agentName, agentCommission, setById: actor.id, setByName: actor.name || actor.username, setAt: new Date().toISOString() }
        : null
      await saveStoreKeys({ [SALE_AGENTS_KEY]: JSON.stringify(next ? [...rest, next] : rest) })
      return next
    })
    return NextResponse.json({ agent })
  })
}
