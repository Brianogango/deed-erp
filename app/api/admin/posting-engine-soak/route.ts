import { userCan } from '@/lib/auth/can'
import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'

import { buildPostingEngineSoakReport } from '@/lib/accounting/posting-soak'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/posting-engine-soak
 * Read-only soak checklist. Never enables ACCOUNTING_POSTING_ENGINE.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!userCan(session.user, 'admin.ledger_checks')) {
    return NextResponse.json({ error: 'Forbidden — Finance or Director only' }, { status: 403 })
  }

  const report = buildPostingEngineSoakReport()
  return NextResponse.json(report)
}
