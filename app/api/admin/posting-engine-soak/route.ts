import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { buildPostingEngineSoakReport } from '@/lib/accounting/posting-soak'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/posting-engine-soak
 * Read-only soak checklist. Never enables ACCOUNTING_POSTING_ENGINE.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, ['director', 'finance_officer'])) {
    return NextResponse.json({ error: 'Forbidden — Finance or Director only' }, { status: 403 })
  }

  const report = buildPostingEngineSoakReport()
  return NextResponse.json(report)
}
