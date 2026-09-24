import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { mirrorRepairsToPrisma } from '@/lib/repair-mirror'
import { isSuperAdminRole } from '@/lib/auth/authorization'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/backfill-repairs
 * One-off/maintenance: mirrors every repair in deed_repairs_v2 into the
 * relational repairs table (repairs migration phase 1).
 * Requires a director session, or the x-internal-secret header for
 * server-side maintenance runs.
 */
export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = req.headers.get('x-internal-secret')
  const secretOk = Boolean(internalSecret && providedSecret === internalSecret)

  if (!secretOk) {
    const session = await getServerSession()
    if (!session || !isSuperAdminRole(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state['deed_repairs_v2']) ? state['deed_repairs_v2'] : []
  const result = await mirrorRepairsToPrisma(repairs, { force: true })
  return NextResponse.json({ ok: true, total: (repairs as unknown[]).length, ...result })
}
