import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function stateHash(state: unknown): string {
  return crypto.createHash('md5').update(JSON.stringify(state)).digest('hex').slice(0, 8)
}

/**
 * GET /api/store/stream
 * Server-Sent Events stream for real-time store sync.
 * Replaces the 3-second client-side polling with a persistent connection.
 * Server checks for state changes every 5s and only sends data when something changed.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const enc = new TextEncoder()
  let lastHash = ''

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      const ping = () => {
        try { controller.enqueue(enc.encode(': ping\n\n')) } catch { /* disconnected */ }
      }

      const SSE_MAX_KEY_BYTES = 512 * 1024  // skip individual keys > 512 KB from broadcast

      const checkState = async () => {
        try {
          const state = await loadAppState()
          // Strip keys whose serialised value is too large to broadcast efficiently.
          // Large blobs (profile photos, base64 PDFs) are served via direct API calls instead.
          const lean: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(state)) {
            if (JSON.stringify(v).length <= SSE_MAX_KEY_BYTES) lean[k] = v
          }
          const hash = stateHash(lean)
          if (hash !== lastHash) {
            lastHash = hash
            send('store', { state: lean })
          }
        } catch { /* DB error — skip this tick, retry next */ }
      }

      // Send initial state immediately on connect
      await checkState()

      const stateId = setInterval(checkState, 5_000)
      const pingId  = setInterval(ping, 20_000)

      request.signal.addEventListener('abort', () => {
        clearInterval(stateId)
        clearInterval(pingId)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // Prevent nginx from buffering SSE
    },
  })
}
