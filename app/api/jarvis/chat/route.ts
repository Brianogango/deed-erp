import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { hasModuleAccess } from '@/lib/auth/access'
import { runChatTurn, type ChatTurnMessage } from '@/lib/jarvis/chat-engine'

function getIP(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? null
}

const MAX_MESSAGE_LENGTH = 4000
const MAX_HISTORY_MESSAGES = 20

/**
 * POST /api/jarvis/chat
 * Body: { conversationId?: string, message: string }
 * Creates a conversation if conversationId is omitted. Runs the message
 * through the DIA tool-calling engine and persists both sides plus any
 * tool calls made, then returns the assistant's reply.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user

    if (!hasModuleAccess(user, 'jarvis')) {
      return NextResponse.json({ error: 'DIA is not enabled for your account' }, { status: 403 })
    }

    const body = await request.json()
    const message: string = String(body.message ?? '').trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `message must be under ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 })
    }

    let conversationId: string | undefined = body.conversationId
    if (conversationId) {
      const existing = await prisma.aiConversation.findFirst({
        where: { id: conversationId, userId: user.id },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
    } else {
      const created = await prisma.aiConversation.create({
        data: { userId: user.id, title: message.slice(0, 80) },
      })
      conversationId = created.id
    }

    const priorMessages = await prisma.aiMessage.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'asc' },
      take: MAX_HISTORY_MESSAGES,
    })

    const history: ChatTurnMessage[] = priorMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    await prisma.aiMessage.create({
      data: { conversationId, role: 'user', content: message },
    })

    const result = await runChatTurn({
      user,
      conversationId,
      ipAddress: getIP(request),
      history,
      userMessage: message,
    })

    await prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: result.reply,
        citedSources: result.sources.length > 0
          ? (result.sources as any)
          : result.toolCalls.length > 0
            ? (result.toolCalls as any)
            : undefined,
      },
    })

    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })

    return NextResponse.json({
      conversationId,
      reply: result.reply,
      sources: result.sources,
      toolCalls: result.toolCalls.map(tc => ({
        toolName: tc.toolName,
        allowed: tc.allowed,
        error: tc.error,
      })),
    })
  })
}
