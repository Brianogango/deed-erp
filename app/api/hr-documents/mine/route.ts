import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

/** The documents HR has shared with the signed-in employee. Other staff records are never returned. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    if (!user.employeeId) return NextResponse.json([])
    const state = await loadAppState(['deed_hrDocuments'])
    const docs = Array.isArray(state.deed_hrDocuments) ? (state.deed_hrDocuments as Array<Record<string, unknown>>) : []
    return NextResponse.json(
      docs
        .filter(d => d?.employeeId === user.employeeId && d?.visibility === 'employee_visible')
        .map(d => ({
          id: String(d.id ?? ''), title: String(d.title ?? ''), type: String(d.type ?? 'other'),
          expiryDate: d.expiryDate ? String(d.expiryDate) : undefined,
          fileName: d.fileName ? String(d.fileName) : undefined,
        })),
    )
  })
}
