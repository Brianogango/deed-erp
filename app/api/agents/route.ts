/**
 * Deed Express agent commissions (lib/agents/agent-commissions.ts).
 *
 * GET — agents, commission lines (brought up to date with the sales first),
 *       payouts and settings.
 * PUT — settings: withholding tax on payouts on/off and its rate.
 */
import { NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'
import { AGENT_SETTINGS_KEY, loadAgentOverview, readAgentSettings } from '@/lib/agents/agent-commissions.server'

export const dynamic = 'force-dynamic'

const ROLES = ['director', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    return NextResponse.json(await loadAgentOverview())
  })
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const body = await request.json().catch(() => ({})) as { withholdingEnabled?: unknown; withholdingRate?: unknown }
    const rate = Number(body.withholdingRate)
    if (body.withholdingRate !== undefined && (!Number.isFinite(rate) || rate <= 0 || rate >= 100)) {
      return NextResponse.json({ error: 'Withholding rate must be between 0 and 100' }, { status: 422 })
    }
    const settings = readAgentSettings(body)
    await saveStoreKeys({ [AGENT_SETTINGS_KEY]: JSON.stringify(settings) })
    return NextResponse.json({ settings })
  })
}
