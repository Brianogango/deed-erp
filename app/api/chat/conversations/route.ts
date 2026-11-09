import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { createGroup, listConversations, openDirect } from '@/lib/chat/chat.server'

export const dynamic = 'force-dynamic'

/** GET — my conversations, newest first, with unread counts. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const conversations = await listConversations(session.user.id)
    return NextResponse.json({ conversations }, { headers: { 'Cache-Control': 'no-store' } })
  })
}

/** POST { kind: 'direct', userId } | { kind: 'group', name, memberIds } — opens or creates one. */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json().catch(() => ({})) as { kind?: string; userId?: string; name?: string; memberIds?: unknown }
    const { listPublicUsers } = await import('@/lib/auth/users-repository')
    const active = new Set((await listPublicUsers()).filter(u => u.active !== false).map(u => u.id))
    if (body.kind === 'group') {
      const memberIds = (Array.isArray(body.memberIds) ? body.memberIds : []).map(String).filter(id => active.has(id))
      const id = await createGroup(session.user.id, String(body.name ?? ''), memberIds)
      return NextResponse.json({ id }, { status: 201 })
    }
    const other = String(body.userId ?? '')
    if (!active.has(other)) return NextResponse.json({ error: 'That person is not an active user' }, { status: 422 })
    const id = await openDirect(session.user.id, other)
    return NextResponse.json({ id })
  })
}
