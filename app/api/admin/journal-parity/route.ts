import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { verifyJournalParityReport } from '@/lib/blob-cutover.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/admin/journal-parity
 * Director-only deep parity for deed_journalEntries (ref coverage + amount sample).
 * Read-only — never mutates blob or Prisma.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, ['director', 'finance_officer'])) {
    return NextResponse.json({ error: 'Forbidden — Finance or Director only' }, { status: 403 })
  }

  const report = await verifyJournalParityReport()
  return NextResponse.json(report)
}
