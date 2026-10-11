import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { removeDocument, reviewDocument, toScreen } from '@/lib/credit/credit-facility.server'

type Params = { params: Promise<{ id: string; docId: string }> }

/** PATCH { status: received|verified|rejected, expiresOn, note } — Finance. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, docId } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const body = await req.json().catch(() => ({}))
    const app = await reviewDocument(actor, id, docId, body ?? {})
    return NextResponse.json({ application: await toScreen(app, { withChecks: true }) })
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, docId } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const app = await removeDocument(actor, id, docId)
    return NextResponse.json({ application: await toScreen(app, { withChecks: true }) })
  })
}
