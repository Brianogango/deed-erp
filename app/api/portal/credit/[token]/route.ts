import { NextRequest, NextResponse } from 'next/server'
import { applicationForToken, portalSaveForm, toPortalView } from '@/lib/credit/credit-facility.server'
import { noStore, portalHandler } from '@/lib/credit/portal-guard.server'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string }> }

/** GET — the client's application (public, by link). */
export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params
  return portalHandler(req, 'read', 300, async () =>
    NextResponse.json({ application: await toPortalView(await applicationForToken(token)) }, { headers: noStore }), token)
}

/** PUT { form, requestedLimit, requestedTermsDays } — save the form. */
export async function PUT(req: NextRequest, { params }: Params) {
  const { token } = await params
  return portalHandler(req, 'save', 200, async () => {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ application: await toPortalView(await portalSaveForm(token, body ?? {})) }, { headers: noStore })
  }, token)
}
