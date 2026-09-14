import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { listPublicUsers } from '@/lib/auth/users-repository'
import { assignableTechnicians, toAssignableTechnicianPublic } from '@/lib/repair/assignable-technicians'

const READ_ROLES = ['director', 'admin_officer', 'technical_lead']

/**
 * Compact assignable-technician list for the repair assignment picker.
 * Technical leads cannot GET /api/users (viewUsers is director/admin only),
 * so this is the allowed way to see other bench techs without the full
 * user-admin directory.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(READ_ROLES)
    const users = await listPublicUsers()
    let employees: Array<{ id: string; status: string }> = []
    try {
      const rows = await prisma.employee.findMany({
        select: { id: true, isActive: true },
      })
      employees = rows.map(row => ({
        id: row.id,
        status: row.isActive ? 'active' : 'exited',
      }))
    } catch {
      employees = []
    }
    const technicians = assignableTechnicians(users, employees).map(toAssignableTechnicianPublic)
    return NextResponse.json({ technicians })
  })
}
