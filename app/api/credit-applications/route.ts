import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { createApplication, listApplications, toScreen } from '@/lib/credit/credit-facility.server'

/** GET /api/credit-applications?clientId=&status=open|<status> */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireCreditUser()
    const url = new URL(req.url)
    const applications = await listApplications({ clientId: url.searchParams.get('clientId'), status: url.searchParams.get('status') })
    return NextResponse.json({ applications })
  })
}

/** POST /api/credit-applications { clientId, requestedLimit, requestedTermsDays, note } */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireCreditUser()
    const body = await req.json().catch(() => ({}))
    if (!body?.clientId) return NextResponse.json({ error: 'Choose the customer' }, { status: 400 })
    const app = await createApplication(actor, body)
    return NextResponse.json({ application: await toScreen(app, { withChecks: true }) }, { status: 201 })
  })
}
