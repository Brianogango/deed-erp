import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { getUnreadClientMessages } from '@/lib/portal-repair-messages'

export const dynamic = 'force-dynamic'

/**
 * GET /api/repairs/client-messages — repairs whose client has written and no
 * one on staff has opened the chat since: { unread: { REF: { count, lastAt,
 * lastText, senderName } } }. The repairs list flags them.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('repair.edit')
    return NextResponse.json({ unread: await getUnreadClientMessages() })
  })
}
