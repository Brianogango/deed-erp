import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { formatRoleLabel } from '@/lib/auth/access'

export const dynamic = 'force-dynamic'

/** GET — the active users anyone can chat with (name and role only). */
export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { listPublicUsers } = await import('@/lib/auth/users-repository')
    const people = (await listPublicUsers())
      .filter(u => u.active !== false)
      .map(u => ({ id: u.id, name: u.name || u.username, role: formatRoleLabel(u.role) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ people }, { headers: { 'Cache-Control': 'no-store' } })
  })
}
