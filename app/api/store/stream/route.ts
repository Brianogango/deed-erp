import { NextRequest } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, loadAppStateMeta } from '@/lib/server-store'
import type { AppStateMeta } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/store/stream
 * Server-Sent Events stream for real-time store sync.
 * Uses cheap key/updated_at metadata checks, then loads only changed keys.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const enc = new TextEncoder()
  let lastMeta: AppStateMeta = {}
  let ready = false

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
      const SSE_INITIAL_CHUNK_SIZE = 6

      const changedKeysFromMeta = (nextMeta: AppStateMeta) => {
        const changed: string[] = []
        for (const [key, meta] of Object.entries(nextMeta)) {
          const previous = lastMeta[key]
          if (!previous || previous.updatedAt !== meta.updatedAt || previous.bytes !== meta.bytes) {
            changed.push(key)
          }
        }
        for (const key of Object.keys(lastMeta)) {
          if (!nextMeta[key]) changed.push(key)
        }
        return changed
      }

      const sendKeys = async (keys: string[]) => {
        const eligibleKeys = keys.filter(key => {
          const bytes = lastMeta[key]?.bytes ?? 0
          return bytes > 0 && bytes <= SSE_MAX_KEY_BYTES
        })
        if (eligibleKeys.length === 0) return
        const state = await loadAppState(eligibleKeys)
        if (Object.keys(state).length > 0) send('store', { state })
      }

      const checkState = async (sendInitial = false) => {
        try {
          const nextMeta = await loadAppStateMeta()
          const keys = sendInitial ? Object.keys(nextMeta) : changedKeysFromMeta(nextMeta)
          lastMeta = nextMeta
          if (sendInitial) {
            for (let i = 0; i < keys.length; i += SSE_INITIAL_CHUNK_SIZE) {
              await sendKeys(keys.slice(i, i + SSE_INITIAL_CHUNK_SIZE))
            }
          } else if (ready && keys.length > 0) {
            await sendKeys(keys)
          }
        } catch { /* DB error — skip this tick, retry next */ }
      }

      // Establish the baseline immediately, then hydrate remote keys in small
      // chunks after the first paint so the ERP shell does not hang on login.
      await checkState(false)
      ready = true
      setTimeout(() => void checkState(true), 750)

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
