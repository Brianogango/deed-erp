import { NextRequest } from 'next/server'
import { getRequiredSession } from '@/lib/auth/api'
import { subscribeChatChanges } from '@/lib/chat/realtime.server'

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
      const send = () => {
        try { controller.enqueue(enc.encode('event: chat\ndata: {"changed":true}\n\n')) } catch {}
      }
      const ping = () => {
        try { controller.enqueue(enc.encode(': ping\n\n')) } catch {}
      }

      try { controller.enqueue(enc.encode('event: ready\ndata: {}\n\n')) } catch {}
      const unsubscribe = subscribeChatChanges(session.user.id, send)
      const fallback = setInterval(send, 30_000)
      const pingId = setInterval(ping, 20_000)

      request.signal.addEventListener('abort', () => {
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
