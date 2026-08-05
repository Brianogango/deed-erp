// Rate limiting — uses Upstash Redis when configured, in-memory fallback otherwise.
// Swap: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env.

export interface RateLimitResult {
  success: boolean
  remaining: number
  resetAt: number
}

// ── Upstash path ─────────────────────────────────────────────────────────────
// Loaded lazily so missing env vars don't crash cold-start in dev.
let _upstash: null | {
  ratelimit: (key: string, limit: number, windowSec: number) => Promise<RateLimitResult>
} = null

async function getUpstash() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null
  if (_upstash) return _upstash

  const { Redis } = await import('@upstash/redis')
  const { Ratelimit } = await import('@upstash/ratelimit')
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  })
  _upstash = {
    ratelimit: async (key, limit, windowSec) => {
      const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`) })
      const { success, remaining, reset } = await rl.limit(key)
      return { success, remaining, resetAt: reset }
    },
  }
  return _upstash
}

// ── In-memory fallback ───────────────────────────────────────────────────────
interface Entry { count: number; resetAt: number }
const memStore = new Map<string, Entry>()
let lastPrune = Date.now()

function memCheck(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  if (now - lastPrune > 5 * 60_000) {
    lastPrune = now
    memStore.forEach((e, k) => { if (e.resetAt < now) memStore.delete(k) })
  }
  const entry = memStore.get(key)
  if (!entry || entry.resetAt < now) {
    memStore.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: limit - 1, resetAt: now + windowMs }
  }
  if (entry.count >= limit) return { success: false, remaining: 0, resetAt: entry.resetAt }
  entry.count++
  return { success: true, remaining: limit - entry.count, resetAt: entry.resetAt }
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function checkRateLimit(
  key: string,
  limit = 10,
  windowSec = 60,
): Promise<RateLimitResult> {
  const upstash = await getUpstash()
  if (upstash) return upstash.ratelimit(key, limit, windowSec)
  return memCheck(key, limit, windowSec * 1000)
}

// Convenience wrappers — E2E suites log in many times from one IP; relax only
// when explicitly opted in (CI / playwright.config), never by default in prod.
const e2eRelaxed = () => process.env.E2E_RELAX_RATE_LIMIT === '1'

export const loginRatelimit = {
  limit: (ip: string) => checkRateLimit(`login:${ip}`, e2eRelaxed() ? 120 : 10, 60),
}

export const apiRatelimit = {
  limit: (ip: string) => checkRateLimit(`api:${ip}`, 120, 60),
}

export const salesRatelimit = {
  limit: (ip: string) => checkRateLimit(`sales:${ip}`, 50, 3600),
}
