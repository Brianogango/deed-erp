import { NextRequest, NextResponse } from 'next/server'
import { registerPortalRepair, clearApprovalDecision, type PortalRepair } from '@/lib/portal-repairs'
import { saveStoreKeys } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'

// This endpoint pushes ERP repair data into the public portal registry. It is
// only ever called by the authenticated ERP client — never by customers — so
// it requires a session even though it lives under the public /api/portal path.
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
