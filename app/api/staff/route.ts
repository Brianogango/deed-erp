/**
 * GET — colleagues' names for pickers and name lookups (assign, hand over,
 * staff member on a purchase). Any signed-in user; no account details —
 * the full user list stays with whoever manages user accounts (viewUsers).
 */
import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { listPublicUsers } from '@/lib/auth/users-repository'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const staff = (await listPublicUsers()).map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      active: u.active,
      actsAsTechnician: Boolean(u.actsAsTechnician),
    }))
    return NextResponse.json({ staff }, { headers: { 'Cache-Control': 'private, no-store' } })
  })
}
