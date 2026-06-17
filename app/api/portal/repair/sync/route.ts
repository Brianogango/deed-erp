import { NextRequest, NextResponse } from 'next/server'
import { registerPortalRepair, clearApprovalDecision, type PortalRepair } from '@/lib/portal-repairs'
import { saveStoreKeys } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'

async function canSyncPortalRepair(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = req.headers.get('x-internal-secret')
  if (internalSecret && providedSecret === internalSecret) return true

  const session = await getServerSession()
  return !!session?.user && ['director', 'admin_officer', 'technical_lead', 'technician'].includes(session.user.role)
}

export async function POST(req: NextRequest) {
  if (!await canSyncPortalRepair(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { repair } = await req.json() as { repair: PortalRepair }
  if (!repair?.ref) return NextResponse.json({ error: 'Missing repair ref' }, { status: 400 })

  // When a quote is revised the repair goes back to awaiting_approval.
  // Clear any previous approval decision so the customer sees the new quote.
  if (repair.status === 'awaiting_approval') {
    clearApprovalDecision(repair.ref)
    await saveStoreKeys({
      [`portal_approval_${repair.ref.toUpperCase()}`]: JSON.stringify(null),
    })
  }

  registerPortalRepair(repair)
  return NextResponse.json({ ok: true })
}
