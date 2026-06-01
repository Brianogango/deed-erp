import { NextRequest, NextResponse } from 'next/server'
import { registerPortalRepair, clearApprovalDecision, type PortalRepair } from '@/lib/portal-repairs'
import { saveStoreKeys } from '@/lib/server-store'

export async function POST(req: NextRequest) {
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
