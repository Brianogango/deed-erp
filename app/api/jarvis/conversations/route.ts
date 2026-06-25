import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { hasModuleAccess } from '@/lib/auth/access'

/**
 * GET /api/jarvis/conversations
 * Lists the current user's own JARVIS conversations (their memory). Users
 * never see another user's chat history — there is no admin override here.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!hasModuleAccess(session.user, 'jarvis')) {
      return NextResponse.json({ error: 'JARVIS is not enabled for your account' }, { status: 403 })
    }

    const conversations = await prisma.aiConversation.findMany({
      where: { userId: session.user.id, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })

    return NextResponse.json(conversations)
  })
}
