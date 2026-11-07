import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { issueWarrantiesForSale } from '@/lib/warranty/e-warranty.server'

export const dynamic = 'force-dynamic'

/**
 * POST { source: 'pos' | 'delivery', id, ref, date?, customerId?, customerName?, lines: [{ serialId, productId, productName? }] }
 * Issue this sale's warranties now (for the receipt / invoice being printed) and return them with links.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const b = await req.json().catch(() => ({})) as Record<string, any>
    const source = b.source === 'delivery' ? 'delivery' : b.source === 'pos' ? 'pos' : null
    const id = String(b.id ?? '').trim().slice(0, 80)
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200)
      .map((l: any) => ({ serialId: l?.serialId ? String(l.serialId).slice(0, 80) : undefined, productId: String(l?.productId ?? '').slice(0, 80), productName: l?.productName ? String(l.productName).slice(0, 300) : undefined }))
      .filter((l: { serialId?: string }) => l.serialId)
    if (!source || !id) return NextResponse.json({ error: 'Say which sale' }, { status: 400 })
    if (!lines.length) return NextResponse.json({ warranties: [] })
    const warranties = await issueWarrantiesForSale({
      source, id, ref: String(b.ref ?? '').slice(0, 80), date: b.date ? String(b.date).slice(0, 10) : undefined,
      customerId: b.customerId ? String(b.customerId).slice(0, 80) : undefined,
      customerName: b.customerName ? String(b.customerName).slice(0, 200) : undefined,
      lines,
    })
    return NextResponse.json({ warranties })
  })
}
