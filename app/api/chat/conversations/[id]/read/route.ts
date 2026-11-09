import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { markRead } from '@/lib/chat/chat.server'

export const dynamic = 'force-dynamic'

/** POST — everything in the conversation is read. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    await markRead(session.user.id, id)
    return NextResponse.json({ ok: true })
  })
}
