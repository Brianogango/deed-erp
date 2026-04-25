import { NextRequest, NextResponse } from 'next/server'
import { approvalDecisions } from '@/lib/portal-repairs'
import { lookupRepair } from '@/lib/portal-repair-server'

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } }
) {
  const ref = decodeURIComponent(params.ref)
  const repair = await lookupRepair(ref)

  if (!repair) {
    return NextResponse.json({ error: 'Repair not found.' }, { status: 404 })
  }

  if (repair.status !== 'awaiting_approval') {
    return NextResponse.json(
      { error: `Quote cannot be actioned — current status is "${repair.status}".` },
      { status: 409 }
    )
  }

  const body = await req.json() as { approved: boolean; reason?: string }
  const { approved, reason } = body
  const date = new Date().toISOString().slice(0, 10)

  approvalDecisions.set(ref.toUpperCase(), {
    approved,
    reason: reason ?? undefined,
    date,
  })

  if (repair.customerPhone) {
    const message = approved
      ? `Hi ${repair.customerName}, you have approved the repair quote for your ${repair.productName} (${repair.ref}). Our team will begin work shortly.`
      : `Hi ${repair.customerName}, we have received your decision to decline the repair quote for ${repair.productName} (${repair.ref}). We will contact you regarding next steps.`
    fetch(`${req.nextUrl.origin}/api/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'general', to: repair.customerPhone, message, priority: 'high' }),
    }).catch(() => {})
  }

  const updated = await lookupRepair(ref)
  return NextResponse.json({ repair: updated, approved }, { status: 200 })
}
