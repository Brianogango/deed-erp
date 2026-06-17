import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/api'
import { buildRepairPortalUrl } from '@/lib/repair-token'

const STAFF_ROLES = ['director', 'admin_officer', 'technical_lead', 'technician']

export async function POST(request: NextRequest) {
  try {
    await requireRole(STAFF_ROLES)
    const body = await request.json().catch(() => ({})) as { ref?: string }
    const ref = body.ref?.trim()
    if (!ref) return NextResponse.json({ error: 'Repair reference is required.' }, { status: 400 })
    return NextResponse.json({ url: buildRepairPortalUrl(ref) })
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : status === 401 ? 'Unauthorized' : 'Failed to create repair portal link' }, { status })
  }
}
