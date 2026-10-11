import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { loadApplication, toScreen, updateApplication } from '@/lib/credit/credit-facility.server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireCreditUser()
    return NextResponse.json({ application: await toScreen(await loadApplication(id), { withChecks: true }) })
  })
}

/** PATCH: the form, requested terms, or (Finance) the credit check. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const body = await req.json().catch(() => ({}))
    const app = await updateApplication(actor, id, body ?? {})
    return NextResponse.json({ application: await toScreen(app, { withChecks: true }) })
  })
}
