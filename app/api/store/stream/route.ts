import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { getLatestAppStateUpdatedAt, loadChangedStoreKeysSince } from '@/lib/server-store'
import { getStoreNotifyLive, subscribeAppStateChanges } from '@/lib/store-notify'
import { canReadStoreKey } from '@/lib/auth/authorization'
import { SSE_FALLBACK_POLL_MS } from '@/lib/store-sse-diff'

export const dynamic = 'force-dynamic'

// Overlap window applied when a client (re)connects: changes committed in the
// last N ms before connect are re-sent so nothing is missed between the page
// hydration / a dropped connection and the new stream.
const CONNECT_OVERLAP_MS = 60_000

function minusOverlap(isoTimestamp: string): string {
  const t = Date.parse(isoTimestamp)
  if (!Number.isFinite(t)) return isoTimestamp
  return new Date(t - CONNECT_OVERLAP_MS).toISOString()
}

function parseWatchedKeys(request: NextRequest): Set<string> | null {
  const raw = request.nextUrl.searchParams.get('keys')
  if (!raw) return null
  const keys = raw.split(',').map(key => key.trim()).filter(key => key.startsWith('deed_'))
  return keys.length ? new Set(keys) : null
}

/**
 * GET /api/store/stream
 * Server-Sent Events stream for real-time store sync.
 *
 * The stream only announces which keys changed. Clients GET those keys if the
 * current screen needs them. Reconstructing every changed collection here
 * used to reload serials, journals, and audit logs for every open tab.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const watched = parseWatchedKeys(request)
  const enc = new TextEncoder()
  let lastUpdatedAt = ''
  const announced = new Set<string>()

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

      ping()

      const checkState = async () => {
        try {
          if (!lastUpdatedAt) {
            const latest = await getLatestAppStateUpdatedAt()
            lastUpdatedAt = latest ? minusOverlap(latest) : new Date(Date.now() - CONNECT_OVERLAP_MS).toISOString()
          }

          const { keys, latestUpdatedAt } = await loadChangedStoreKeysSince(
            lastUpdatedAt,
            watched ? [...watched] : undefined,
          )
          const readable = keys.filter(key => canReadStoreKey(session.user, key))
          const invalidated = readable.filter(key => !announced.has(`${key}:${latestUpdatedAt}`))
          if (!invalidated.length) {
            lastUpdatedAt = latestUpdatedAt
            return
          }
          for (const key of invalidated) announced.add(`${key}:${latestUpdatedAt}`)
          send('store', { state: {}, patch: true, invalidated })
          lastUpdatedAt = latestUpdatedAt
        } catch { /* DB error — skip this tick, retry next */ }
      }

      let notifyTimer: ReturnType<typeof setTimeout> | null = null
      const unsubscribe = subscribeAppStateChanges(() => {
        if (notifyTimer) return
        notifyTimer = setTimeout(() => { notifyTimer = null; void checkState() }, 150)
      })

      send('hello', { liveNotify: await getStoreNotifyLive() })
      await checkState()

      const stateId = setInterval(checkState, SSE_FALLBACK_POLL_MS)
      const pingId  = setInterval(ping, 20_000)

      request.signal.addEventListener('abort', () => {
        unsubscribe()
        if (notifyTimer) clearTimeout(notifyTimer)
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
      'X-Accel-Buffering': 'no',
    },
  })
}
