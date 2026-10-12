import { NextRequest, NextResponse } from 'next/server'
import { portalSubmit, toPortalView } from '@/lib/credit/credit-facility.server'
import { noStore, portalHandler } from '@/lib/credit/portal-guard.server'

export const dynamic = 'force-dynamic'

/** POST — the client submits the application to Deed Technologies. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return portalHandler(req, 'submit', 20, async () =>
    NextResponse.json({ application: await toPortalView(await portalSubmit(token)) }, { headers: noStore }), token)
}
