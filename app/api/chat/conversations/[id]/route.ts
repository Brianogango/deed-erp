import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { updateGroup } from '@/lib/chat/chat.server'

export const dynamic = 'force-dynamic'

/** PATCH { name?, add?: userId[], remove?: userId, leave?: true } — group changes. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    const body = await request.json().catch(() => ({})) as { name?: string; add?: unknown; remove?: string; leave?: boolean }
    let add: string[] | undefined
    if (Array.isArray(body.add)) {
      const { listPublicUsers } = await import('@/lib/auth/users-repository')
      const active = new Set((await listPublicUsers()).filter(u => u.active !== false).map(u => u.id))
      add = body.add.map(String).filter(u => active.has(u))
    }
    await updateGroup(session.user.id, id, { name: body.name, add, remove: body.remove ? String(body.remove) : undefined, leave: body.leave === true })
    return NextResponse.json({ ok: true })
  })
}
