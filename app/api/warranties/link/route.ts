import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState } from '@/lib/server-store'
import { warrantyToken } from '@/lib/warranty/e-warranty.server'
import { warrantyPath } from '@/lib/warranty/e-warranty'

export const dynamic = 'force-dynamic'

/** GET ?id=<warranty id> → the certificate link to copy, send or open. */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    const state = await loadAppState(['deed_warranties'])
    const found = (Array.isArray(state.deed_warranties) ? state.deed_warranties as Array<{ id: string }> : []).some(w => w.id === id)
    if (!id || !found) return NextResponse.json({ error: 'Warranty not found — refresh the page' }, { status: 404 })
    return NextResponse.json({ path: warrantyPath(warrantyToken(id)) })
  })
}
