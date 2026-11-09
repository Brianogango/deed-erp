import { NextRequest } from 'next/server'
import { getRequiredSession } from '@/lib/auth/api'
import { subscribeChatChanges, type ChatEvent } from '@/lib/chat/realtime.server'
import { touchPresence } from '@/lib/chat/chat.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let session
  try {
    session = await getRequiredSession()
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const write = (text: string) => { try { controller.enqueue(enc.encode(text)) } catch {} }
      const send = (event: ChatEvent = { kind: 'changed' }) => {
        if (event.kind === 'typing') write(`event: typing\ndata: ${JSON.stringify({ conversationId: event.conversationId, from: event.from })}\n\n`)
        else write('event: chat\ndata: {"changed":true}\n\n')
      }
      // An open chat stream is "online"; the ping keeps last seen fresh.
      const ping = () => { write(': ping\n\n'); void touchPresence(session.user.id).catch(() => {}) }

      write('event: ready\ndata: {}\n\n')
      void touchPresence(session.user.id).catch(() => {})
      const unsubscribe = subscribeChatChanges(session.user.id, send)
      const fallback = setInterval(() => send(), 30_000)
      const pingId = setInterval(ping, 20_000)

      request.signal.addEventListener('abort', () => {
        void touchPresence(session.user.id).catch(() => {})
        unsubscribe()
        clearInterval(fallback)
        clearInterval(pingId)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
