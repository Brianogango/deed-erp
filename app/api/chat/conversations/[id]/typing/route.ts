import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { notifyTyping } from '@/lib/chat/chat.server'

export const dynamic = 'force-dynamic'

/** POST — "I am typing" to the other members (the screen sends it every few seconds while typing). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    await notifyTyping(session.user.id, id)
    return NextResponse.json({ ok: true })
  })
}
