import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { refreshStkRequest } from '@/lib/mpesa/service'

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const body = await request.json().catch(() => ({})) as { checkoutRequestId?: string }
    const checkoutRequestId = String(body.checkoutRequestId || '').trim()
    if (!checkoutRequestId) {
      return NextResponse.json({ error: 'checkoutRequestId is required' }, { status: 400 })
    }
    const record = await refreshStkRequest(checkoutRequestId)
    if (!record) return NextResponse.json({ error: 'STK request not found' }, { status: 404 })
    return NextResponse.json(record)
  })
}
