import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { hasModuleAccess } from '@/lib/auth/access'
import { runChatTurn, type ChatTurnMessage } from '@/lib/jarvis/chat-engine'
import { isDiaMode, type DiaMode } from '@/lib/jarvis/modes'
import { parseDiaAttachments } from '@/lib/jarvis/attachments'

function getIP(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? null
}

const MAX_MESSAGE_LENGTH = 4000
const MAX_HISTORY_MESSAGES = 20

/**
 * POST /api/jarvis/chat
 * Body: { conversationId?, message, mode?, pageContext? }
 * Creates a conversation if conversationId is omitted. Runs the message
 * through the DIA tool-calling engine and persists both sides plus any
 * tool calls made, then returns the assistant's reply plus action cards.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const user = session.user

    if (!hasModuleAccess(user, 'jarvis')) {
      return NextResponse.json({ error: 'DIA is not enabled for your account' }, { status: 403 })
    }

    const body = await request.json()
    const parsedAttachments = parseDiaAttachments(body.attachments)
    if (!parsedAttachments.ok) {
      return NextResponse.json({ error: parsedAttachments.error }, { status: 400 })
    }
    const attachments = parsedAttachments.attachments
    const typed: string = String(body.message ?? '').trim()
    const message: string = typed || (attachments.length ? 'Read the attached document and tell me what it is and what you can do with it.' : '')
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `message must be under ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 })
    }

    const mode: DiaMode | undefined = isDiaMode(body.mode) ? body.mode : undefined
    const pageContext =
      body.pageContext && typeof body.pageContext === 'object'
        ? {
            pathname: typeof body.pageContext.pathname === 'string' ? body.pageContext.pathname : undefined,
            module: typeof body.pageContext.module === 'string' ? body.pageContext.module : undefined,
            title: typeof body.pageContext.title === 'string' ? body.pageContext.title : undefined,
          }
        : undefined

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

    // The most recent messages, oldest first (taking the first N in date
    // order dropped the latest context in long conversations).
    const priorMessages = (await prisma.aiMessage.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    })).reverse()
    // The conversation must open with the user's turn.
    while (priorMessages.length && priorMessages[0].role !== 'user') priorMessages.shift()

    const history: ChatTurnMessage[] = priorMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    // Files are read in this turn only; the message keeps their names.
    const storedMessage = attachments.length
      ? `${message}\n[Attached: ${attachments.map(a => a.name).join(', ')}]`
      : message
    await prisma.aiMessage.create({
      data: { conversationId, role: 'user', content: storedMessage },
    })

    const result = await runChatTurn({
      user,
      conversationId,
      ipAddress: getIP(request),
      history,
      userMessage: message,
      attachments,
      mode,
      pageContext,
    })

    await prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: result.reply,
        citedSources: result.sources.length > 0
          ? (result.sources as any)
          : result.toolCalls.length > 0
            ? (result.toolCalls.map(({ confirmToken: _token, ...tc }) => tc) as any)
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
      actions: result.actions,
      toolCalls: result.toolCalls.map(tc => ({
        toolName: tc.toolName,
        allowed: tc.allowed,
        error: tc.error,
      })),
    })
  })
}
