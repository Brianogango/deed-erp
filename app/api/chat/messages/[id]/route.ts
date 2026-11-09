import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { deleteMessage } from '@/lib/chat/chat.server'
import { deleteObject } from '@/lib/infra/object-store'

export const dynamic = 'force-dynamic'

/** DELETE — remove one's own message (and its file). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const { id } = await params
    const { attachmentKey } = await deleteMessage(session.user.id, id)
    if (attachmentKey) await deleteObject('uploads', attachmentKey).catch(() => {})
    return NextResponse.json({ ok: true })
  })
}
