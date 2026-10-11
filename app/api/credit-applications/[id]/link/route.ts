import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { issuePortalLink, toScreen } from '@/lib/credit/credit-facility.server'

/** POST { email?, renew? } — create (and optionally email) the client's link. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const body = await req.json().catch(() => ({}))
    const out = await issuePortalLink(actor, id, { email: body?.email ?? null, renew: Boolean(body?.renew) })
    return NextResponse.json({ url: out.url, expiresAt: out.expiresAt, emailed: out.emailed, application: await toScreen(out.app, { withChecks: true }) })
  })
}
