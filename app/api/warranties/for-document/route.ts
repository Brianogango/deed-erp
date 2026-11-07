import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { documentWarranties } from '@/lib/warranty/e-warranty.server'

export const dynamic = 'force-dynamic'

/** GET ?invoiceId= | ?posOrderId= | ?saleOrderId= → the warranties that document carries, with links. */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const p = req.nextUrl.searchParams
    const q = {
      invoiceId: p.get('invoiceId') || undefined,
      posOrderId: p.get('posOrderId') || undefined,
      saleOrderId: p.get('saleOrderId') || undefined,
    }
    if (!q.invoiceId && !q.posOrderId && !q.saleOrderId) return NextResponse.json({ error: 'Say which document' }, { status: 400 })
    return NextResponse.json({ warranties: await documentWarranties(q) })
  })
}
