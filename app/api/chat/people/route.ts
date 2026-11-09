import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { formatRoleLabel } from '@/lib/auth/access'
import { presenceMap } from '@/lib/chat/chat.server'

export const dynamic = 'force-dynamic'

/** GET — the active users anyone can chat with: name, role, and when they last had the chat open. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { listPublicUsers } = await import('@/lib/auth/users-repository')
    const [users, seen] = await Promise.all([listPublicUsers(), presenceMap().catch(() => ({} as Record<string, string>))])
    const people = users
      .filter(u => u.active !== false)
      .map(u => ({ id: u.id, name: u.name || u.username, role: formatRoleLabel(u.role), lastSeenAt: seen[u.id] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ people }, { headers: { 'Cache-Control': 'no-store' } })
  })
}
