import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'

const PREVIEW_KEYS = ['deed_repairs_v2', 'deed_invoices', 'deed_purchaseOrders']
const RESTORE_META_KEY = 'deed_backup_restore_meta'

function getRecordCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'director') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = await loadAppState([...PREVIEW_KEYS, RESTORE_META_KEY])
  const snapshot = PREVIEW_KEYS.map((key) => ({
    key,
    currentRecords: getRecordCount(state[key]),
  }))
  const restoreMeta = state[RESTORE_META_KEY] ?? null

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    snapshot,
    restoreMeta,
    warning: 'Preview only. Verify record counts before running any restore operation.',
  })
}
