import { NextRequest, NextResponse } from 'next/server'
import { makeDetailHandlers } from '@/lib/server-store-crud'
import { loadAppState } from '@/lib/server-store'
import { getServerSession } from '@/lib/auth/server'
import type { RepairOrder } from '@/lib/store'
import { repairDatesWriteError } from '@/lib/data-validation'
import { canAccessRecord, filterStoreValueForRole, normalizePermissionRole } from '@/lib/auth/authorization'
import { hasModuleAccess } from '@/lib/auth/access'
import { repairHardDeleteBlocker } from '@/lib/repair-delete'

const config = {
  storeKey: 'deed_repairs_v2',
  allowedWriteRoles: ['director', 'admin_officer', 'technical_lead', 'technician'],
  build: () => '' as unknown as RepairOrder,
  validateWrite: (next: RepairOrder, previous?: RepairOrder) => repairDatesWriteError(next, new Date(), previous),
  validateDelete: (repair: RepairOrder) => repairHardDeleteBlocker(repair as any),
  recordAccess: (user: any, repair: RepairOrder, action: 'patch' | 'delete') => {
    const role = normalizePermissionRole(user.role)
    if (action === 'delete' && role === 'technician') return false
    return canAccessRecord(
      user.role,
      'repair',
      {
        assignedTechnicianId: repair.assignedTechnicianId,
        createdByUserId: repair.createdByUserId,
      },
      user.id,
      { actsAsTechnician: Boolean(user.actsAsTechnician) },
    )
  },
}

const { PATCH, DELETE } = makeDetailHandlers(config)
export { PATCH, DELETE }

/**
 * Lightweight authoritative read for an open Repair detail.
 * This deliberately returns one record rather than rehydrating the full Repair
 * ledger, so cross-module updates can appear without a manual page refresh.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  if (!hasModuleAccess(user, 'repair')) {
    return NextResponse.json({ error: 'Forbidden — no repair module access' }, { status: 403 })
  }

  const { id } = await params
  const state = await loadAppState(['deed_repairs_v2'])
  const all = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as RepairOrder[] : []
  const visible = filterStoreValueForRole(
    { id: user?.id, role: user?.role, modules: user?.modules, actsAsTechnician: user?.actsAsTechnician },
    'deed_repairs_v2',
    all,
  ) as RepairOrder[]
  const repair = visible.find(item => item.id === id)
  if (!repair) return NextResponse.json({ error: 'Repair not found' }, { status: 404 })

  return NextResponse.json({ repair }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
