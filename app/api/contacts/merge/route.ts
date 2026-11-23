import { NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { mergeContacts } from '@/lib/contacts/merge.server'

export const dynamic = 'force-dynamic'

/**
 * Merge a duplicate contact into the one that stays (lib/contacts/merge.server.ts).
 * Director only (sales.contacts.merge). Without `apply: true` it only reports
 * what would move, so the screen can show it before anyone confirms.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('sales.contacts.merge')
    const body = await request.json().catch(() => ({})) as { survivorId?: unknown; mergedId?: unknown; apply?: unknown }
    const survivorId = String(body.survivorId ?? '').trim()
    const mergedId = String(body.mergedId ?? '').trim()
    if (!survivorId || !mergedId || survivorId === mergedId) {
      return NextResponse.json({ error: 'Choose two different contacts' }, { status: 400 })
    }
    try {
      const outcome = await mergeContacts({ survivorId, mergedId, userId: user.id, apply: body.apply === true })
      return NextResponse.json({ ok: true, ...outcome }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const status = (error as { status?: number })?.status
      if (status === 404) return NextResponse.json({ error: (error as Error).message }, { status })
      throw error
    }
  })
}
