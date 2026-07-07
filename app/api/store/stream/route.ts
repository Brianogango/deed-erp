import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { getLatestAppStateUpdatedAt, loadAppStateChangesSince, loadInitialAppState } from '@/lib/server-store'
import { SENSITIVE_STORE_KEY_READ_PERMISSIONS, hasPermission } from '@/lib/auth/authorization'
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
  let lastUpdatedAt = ''

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

      const SSE_MAX_KEY_BYTES = 256 * 1024  // skip individual keys > 256 KB from broadcast

      const toLeanState = (state: Record<string, unknown>) => {
        const lean: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(state)) {
          // Never stream HR/payroll/financial keys to a session lacking read access.
          const action = SENSITIVE_STORE_KEY_READ_PERMISSIONS[k]
          if (action && !hasPermission(session.user, action)) continue
          if (JSON.stringify(v).length <= SSE_MAX_KEY_BYTES) lean[k] = v
        }
        return lean
      }

      const checkState = async () => {
        try {
          if (!lastUpdatedAt) {
            const state = await loadInitialAppState()
            const lean = toLeanState(state as Record<string, unknown>)
            const latest = await getLatestAppStateUpdatedAt()
            lastUpdatedAt = latest
            lastHash = stateHash(lean)
            send('store', { state: lean, full: true })
            return
          }

          const { changes, latestUpdatedAt } = await loadAppStateChangesSince(lastUpdatedAt)
          if (!Object.keys(changes).length) return

          const lean = toLeanState(changes as Record<string, unknown>)
          if (!Object.keys(lean).length) {
            lastUpdatedAt = latestUpdatedAt
            return
          }

          const hash = stateHash(lean)
          if (hash !== lastHash) send('store', { state: lean, patch: true })
          lastHash = hash
          lastUpdatedAt = latestUpdatedAt
        } catch { /* DB error — skip this tick, retry next */ }
      }

      // Send initial state immediately on connect
      await checkState()

      const stateId = setInterval(checkState, 10_000)
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
