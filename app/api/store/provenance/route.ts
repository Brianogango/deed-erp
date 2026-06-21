import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'

const AUDIT_KEY = 'deed_audit_timeline_v1'
const RESTORE_META_KEY = 'deed_backup_restore_meta'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = await loadAppState([AUDIT_KEY, RESTORE_META_KEY])
  const timeline = Array.isArray(state[AUDIT_KEY]) ? state[AUDIT_KEY] : []
  const restoreMeta = state[RESTORE_META_KEY] ?? null

  return NextResponse.json({
    ok: true,
    totalEvents: timeline.length,
    latest: timeline.slice(-20).reverse(),
    restoreMeta,
  })
}
