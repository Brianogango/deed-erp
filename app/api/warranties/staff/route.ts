import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { warrantyByToken } from '@/lib/warranty/e-warranty.server'

export const dynamic = 'force-dynamic'

/**
 * Signed-in staff who scan a certificate: the warranty's id, to start a
 * warranty repair from it. Everyone else gets 401 and sees the public check.
 */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const w = await warrantyByToken(String(req.nextUrl.searchParams.get('token') ?? ''))
    if (!w) return NextResponse.json({ error: 'Warranty not found' }, { status: 404 })
    return NextResponse.json({ warrantyId: w.id, customerName: w.customerName })
  })
}
