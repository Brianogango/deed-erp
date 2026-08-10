import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { hasModuleAccess } from '@/lib/auth/access'

/**
 * GET /api/jarvis/conversations/[id]
 * Loads one conversation's messages — only if it belongs to the caller.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!hasModuleAccess(session.user, 'jarvis')) {
      return NextResponse.json({ error: 'DIA is not enabled for your account' }, { status: 403 })
    }

    const conversation = await prisma.aiConversation.findFirst({
      where: { id: params.id, userId: session.user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    return NextResponse.json(conversation)
  })
}

/**
 * DELETE /api/jarvis/conversations/[id]
 * Archives (soft-deletes) a conversation owned by the caller.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!hasModuleAccess(session.user, 'jarvis')) {
      return NextResponse.json({ error: 'DIA is not enabled for your account' }, { status: 403 })
    }

    const conversation = await prisma.aiConversation.findFirst({
      where: { id: params.id, userId: session.user.id },
    })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    await prisma.aiConversation.update({
      where: { id: params.id },
      data: { archivedAt: new Date() },
    })

    return NextResponse.json({ ok: true })
  })
}
