import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

/** Staff only: repairs done on a warranty's machine since it was sold (linked to the warranty, or same serial). */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    const state = await loadAppState(['deed_warranties', 'deed_repairs_v2'])
    const w = (Array.isArray(state.deed_warranties) ? state.deed_warranties as any[] : []).find(x => x?.id === id)
    if (!w) return NextResponse.json({ error: 'Warranty not found' }, { status: 404 })
    const serial = String(w.serialNumber ?? '').trim().toLowerCase()
    const since = String(w.startDate ?? '').slice(0, 10)
    const repairs = (Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as any[] : [])
      .filter(r => r && (r.warrantyId === id || (serial && String(r.serialNumber ?? '').trim().toLowerCase() === serial && String(r.intakeDate ?? r.createdAt ?? '').slice(0, 10) >= since)))
      .map(r => ({
        id: r.id, ref: r.ref, status: r.status,
        date: String(r.intakeDate ?? r.createdAt ?? '').slice(0, 10),
        issue: String(r.issueDescription ?? '').slice(0, 160),
        underWarranty: Boolean(r.underWarranty || r.warrantyId === id),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
    return NextResponse.json({ repairs })
  })
}
