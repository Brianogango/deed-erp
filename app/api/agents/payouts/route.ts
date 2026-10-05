/**
 * POST — pay an agent the chosen commission lines: one bank / M-Pesa / cash
 * journal (Dr 3314 Agent Commissions Payable, Cr bank; withholding tax to
 * 3307 when switched on), the lines marked paid, a payout statement kept.
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { recordAgentPayout } from '@/lib/agents/agent-commissions.server'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']
const METHODS = new Set(['mpesa', 'bank', 'cash'])

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const agentId = String(body.agentId ?? '').trim()
    const commissionIds = Array.isArray(body.commissionIds) ? body.commissionIds.map(String).filter(Boolean) : []
    const method = String(body.method ?? '')
    const reference = String(body.reference ?? '').trim().slice(0, 80)
    const paidAt = String(body.paidAt ?? '').slice(0, 10)
    const bankAccountCode = body.bankAccountCode ? String(body.bankAccountCode).trim() : undefined
    if (!agentId) return NextResponse.json({ error: 'Choose an agent' }, { status: 422 })
    if (!commissionIds.length) return NextResponse.json({ error: 'Choose the commission lines to pay' }, { status: 422 })
    if (!METHODS.has(method)) return NextResponse.json({ error: 'Payment method must be M-Pesa, bank or cash' }, { status: 422 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return NextResponse.json({ error: 'Payment date is required' }, { status: 422 })
    if (method === 'mpesa' && !reference) return NextResponse.json({ error: 'Enter the M-Pesa transaction code' }, { status: 422 })
    const payout = await recordAgentPayout({
      agentId,
      commissionIds,
      method: method as 'mpesa' | 'bank' | 'cash',
      reference,
      paidAt,
      bankAccountCode,
      paidBy: { id: actor.id, name: actor.name || actor.username },
    })
    return NextResponse.json({ payout }, { status: 201 })
  })
}
