import { NextRequest, NextResponse } from 'next/server'
import { approvalDecisions } from '@/lib/portal-repairs'
import { lookupRepair } from '@/lib/portal-repair-server'
import { saveStoreKeys, loadAppState } from '@/lib/server-store'

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

  const decision = { approved, reason: reason ?? undefined, date }

  // Store in-memory for fast lookup during this server process lifetime
  approvalDecisions.set(ref.toUpperCase(), decision)

  // Persist to database so approvals survive server restarts
  await saveStoreKeys({
    [`portal_approval_${ref.toUpperCase()}`]: JSON.stringify(decision),
  })

  // Real-time synchronization: Update ERP state immediately
  const appState = await loadAppState()
  const repairs = (appState['deed_repairs_v2'] as any[]) || []
  const repairIndex = repairs.findIndex((r: any) => r.ref.toUpperCase() === ref.toUpperCase())
  
  if (repairIndex !== -1) {
    const targetRepair = repairs[repairIndex]
    // Only update if it's still awaiting approval to prevent double-processing
    if (targetRepair.status === 'awaiting_approval') {
      // Note: In a real production environment, we would call the store action.
      // Since this is a server-side API route and the store is client-side (useLS),
      // we simulate the update by mutating the persisted state directly.
      targetRepair.status = approved ? 'approved' : 'declined'
      if (approved) {
        targetRepair.quote = {
          ...targetRepair.quote,
          approvedDate: date,
          approvedBy: 'customer'
        }

        const procurementLines = Array.isArray(targetRepair.quote?.lines)
          ? targetRepair.quote.lines.filter((line: any) => ['part', 'software', 'license'].includes(line.type) && !line.reserved)
          : []

        if (procurementLines.length > 0) {
          const request = {
            id: `pr_${Date.now()}`,
            repairId: targetRepair.id,
            repairRef: targetRepair.ref,
            requestedBy: 'customer_approval',
            requestedByName: 'Customer approval automation',
            requestedDate: date,
            urgency: targetRepair.priority === 'urgent' ? 'urgent' : 'normal',
            status: 'pending',
            notes: `Automatically created after customer approved quote ${targetRepair.quote?.id ?? ''}`.trim(),
            items: procurementLines.map((line: any) => ({
              type: line.type,
              productId: line.productId ?? '',
              productName: line.productName ?? line.description ?? 'Quoted item',
              description: line.description ?? '',
              qty: String(line.qty ?? 1),
              estimatedCost: String(line.unitPrice ?? 0),
              supplier: '',
            })),
          }
          targetRepair.status = 'awaiting_parts'
          targetRepair.procurementRequests = [...(targetRepair.procurementRequests ?? []), request]
        }
      } else {
        targetRepair.quote = {
          ...targetRepair.quote,
          rejectedDate: date,
          rejectionReason: reason
        }
      }
      
      await saveStoreKeys({
        'deed_repairs_v2': JSON.stringify(repairs)
      })
    }
  }

  if (repair.customerPhone) {
    const message = approved
      ? `Hi ${repair.customerName}, you have approved the repair quote for your ${repair.productName} (${repair.ref}). Our team will begin work shortly.`
      : `Hi ${repair.customerName}, we have received your decision to decline the repair quote for ${repair.productName} (${repair.ref}). We will contact you regarding next steps.`
    fetch(`${req.nextUrl.origin}/api/notifications/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
      },
      body: JSON.stringify({ type: 'general', to: repair.customerPhone, message, priority: 'high' }),
    }).catch(() => {})
  }

  const updated = await lookupRepair(ref)
  return NextResponse.json({ repair: updated, approved }, { status: 200 })
}
