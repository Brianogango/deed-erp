import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { getLatestAppStateUpdatedAt, loadAppStateChangesSince } from '@/lib/server-store'
import { subscribeAppStateChanges } from '@/lib/store-notify'
import { canReadStoreKey, filterStoreValueForRole } from '@/lib/auth/authorization'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

function stateHash(state: unknown): string {
  return crypto.createHash('md5').update(JSON.stringify(state)).digest('hex').slice(0, 8)
}

// Overlap window applied when a client (re)connects: changes committed in the
// last N ms before connect are re-sent so nothing is missed between the page
// hydration / a dropped connection and the new stream.
const CONNECT_OVERLAP_MS = 60_000

function minusOverlap(isoTimestamp: string): string {
  const t = Date.parse(isoTimestamp)
  if (!Number.isFinite(t)) return isoTimestamp
  return new Date(t - CONNECT_OVERLAP_MS).toISOString()
}

/**
 * GET /api/store/stream
 * Server-Sent Events stream for real-time store sync.
 * Clients hydrate their initial state from the layout's server snapshot and
 * localStorage — the stream only carries CHANGES (with a 60s overlap on
 * connect), never a full app-state dump. Dumping the entire state per
 * connection was a full-table read plus a multi-megabyte push for every tab
 * and every EventSource reconnect.
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

      // Skip individual keys above this size from broadcast. 1 MB so large
      // collaborative blobs (deed_repairs_v2 is ~0.5 MB) still propagate live;
      // binary payloads (receipts/photos) live outside app_state entirely.
      const SSE_MAX_KEY_BYTES = 1024 * 1024

      const toLeanState = (state: Record<string, unknown>) => {
        const lean: Record<string, unknown> = {}
        for (const [k, raw] of Object.entries(state)) {
          // Never stream permission-gated or collaborative keys without both
          // the required role and module grant.
          if (!canReadStoreKey(session.user, k)) continue
          // Collaborative ledgers stream only the slice this user may read.
          const v = filterStoreValueForRole(session.user, k, raw)
          if (JSON.stringify(v).length <= SSE_MAX_KEY_BYTES) lean[k] = v
        }
        return lean
      }

      const checkState = async () => {
        try {
          if (!lastUpdatedAt) {
            // Start streaming from just before "now" — the client already has
            // its initial state; the overlap covers the hydration→connect gap.
            const latest = await getLatestAppStateUpdatedAt()
            lastUpdatedAt = latest ? minusOverlap(latest) : new Date(Date.now() - CONNECT_OVERLAP_MS).toISOString()
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

      // Prime the change cursor and flush the overlap window immediately
      await checkState()

      // Instant path: Postgres NOTIFY wakes the stream the moment app_state
      // changes. Bursts of writes are coalesced into one check per 150ms.
      // checkState is cursor-based and idempotent, so overlapping wake-ups are safe.
      let notifyTimer: ReturnType<typeof setTimeout> | null = null
      const unsubscribe = subscribeAppStateChanges(() => {
        if (notifyTimer) return
        notifyTimer = setTimeout(() => { notifyTimer = null; void checkState() }, 150)
      })

      // Fallback poll (covers a dropped LISTEN connection or missed NOTIFY).
      const stateId = setInterval(checkState, 60_000)
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
      'X-Accel-Buffering': 'no', // Prevent nginx from buffering SSE
    },
  })
}
