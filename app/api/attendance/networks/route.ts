import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { clientIpOrNull } from '@/lib/client-ip'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { addOfficeNetwork, listOfficeNetworks, onOfficeNetwork, removeOfficeNetwork } from '@/lib/hr/attendance.server'
import { networkKey } from '@/lib/hr/attendance-core'

export const dynamic = 'force-dynamic'

/** The office connections clock-ins must come from, and whether this device is on one. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('manageHR')
    const ip = clientIpOrNull(request.headers)
    return NextResponse.json({ networks: await listOfficeNetworks(), current: networkKey(ip), currentIsOffice: await onOfficeNetwork(ip) })
  })
}

/** "Use this connection": saves the connection this request came in on. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageHR')
    const body = await request.json().catch(() => ({})) as { label?: string }
    const network = await addOfficeNetwork(String(body.label ?? ''), clientIpOrNull(request.headers), actor.id)
    await writeFinancialAudit({ userId: actor.id, action: 'attendance.network_added', entityType: 'office_network', entityId: network.id, newValues: network })
    return NextResponse.json({ network })
  })
}

export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('manageHR')
    const id = new URL(request.url).searchParams.get('id') ?? ''
    await removeOfficeNetwork(id)
    await writeFinancialAudit({ userId: actor.id, action: 'attendance.network_removed', entityType: 'office_network', entityId: id, newValues: {} })
    return NextResponse.json({ ok: true })
  })
}
