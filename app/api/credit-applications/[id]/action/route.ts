import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { runAction, toScreen } from '@/lib/credit/credit-facility.server'
import type { CreditAction } from '@/lib/credit/credit-facility-rules'

/** POST { action, note?, approvedLimit?, approvedTermsDays?, conditions? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const body = await req.json().catch(() => ({}))
    const app = await runAction(actor, id, String(body?.action ?? '') as CreditAction, body ?? {})
    return NextResponse.json({ application: await toScreen(app, { withChecks: true }) })
  })
}
