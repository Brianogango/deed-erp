/**
 * Session validity cache for SEC-002.
 *
 * Edge-safe (no `server-only`, no Postgres): middleware and API routes share
 * this module. Persistence across processes uses Upstash when configured;
 * otherwise an in-memory Map is used (per process).
 *
 * Policy:
 * - Cache hit with isActive=false → deny
 * - Cache miss → allow (fail-open); Node callers revalidate from DB
 * - Inactive entries are retained longer so deactivation sticks across TTL
 */

export type SessionStatus = {
  isActive: boolean
  role: string
  actsAsTechnician?: boolean
  invalidatedAt: number
}

export const SESSION_STATUS_TTL_MS = 60_000
/** Keep forced-inactive markers around long enough that JWT sessions die first. */
export const SESSION_INACTIVE_TTL_MS = 12 * 60 * 60 * 1000

type CacheEntry = { status: SessionStatus; expiresAt: number }

const memStore = new Map<string, CacheEntry>()
const REDIS_KEY_PREFIX = 'deed:session-status:'

let lastPrune = Date.now()

function pruneMem(now: number) {
  if (now - lastPrune < 60_000) return
  lastPrune = now
  for (const [key, entry] of memStore) {
    if (entry.expiresAt < now) memStore.delete(key)
  }
}

function redisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

async function getRedis(): Promise<null | { get: (k: string) => Promise<unknown>; set: (k: string, v: string, opts: { ex: number }) => Promise<unknown>; del: (k: string) => Promise<unknown> }> {
  if (!redisConfigured()) return null
  try {
    const { Redis } = await import('@upstash/redis')
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  } catch {
    return null
  }
}

export function getCachedSessionStatus(userId: string): SessionStatus | null {
  if (!userId) return null
  const now = Date.now()
  pruneMem(now)
  const entry = memStore.get(userId)
  if (!entry) return null
  if (entry.expiresAt < now) {
    memStore.delete(userId)
    return null
  }
  return entry.status
}

export function setCachedSessionStatus(
  userId: string,
  status: SessionStatus,
  ttlMs = status.isActive ? SESSION_STATUS_TTL_MS : SESSION_INACTIVE_TTL_MS,
): void {
  if (!userId) return
  memStore.set(userId, { status, expiresAt: Date.now() + ttlMs })
}

export function clearCachedSessionStatus(userId: string): void {
  if (!userId) return
  memStore.delete(userId)
}

/** Test helper — wipe the in-memory map. */
export function __resetSessionStatusCacheForTests(): void {
  memStore.clear()
  lastPrune = Date.now()
}

/**
 * Look up status from memory, then Upstash. Returns null on miss / failure
 * (callers should fail-open).
 */
export async function lookupSessionStatus(userId: string): Promise<SessionStatus | null> {
  if (!userId) return null
  const local = getCachedSessionStatus(userId)
  if (local) return local

  try {
    const redis = await getRedis()
    if (!redis) return null
    const raw = await redis.get(`${REDIS_KEY_PREFIX}${userId}`)
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null
    const status: SessionStatus = {
      isActive: Boolean((parsed as SessionStatus).isActive),
      role: String((parsed as SessionStatus).role ?? ''),
      actsAsTechnician: Boolean((parsed as SessionStatus).actsAsTechnician),
      invalidatedAt: Number((parsed as SessionStatus).invalidatedAt) || Date.now(),
    }
    setCachedSessionStatus(userId, status)
    return status
  } catch {
    return null
  }
}

/**
 * Publish a status into memory (+ Upstash when available).
 * Used after DB reads and on explicit invalidation.
 */
export async function publishSessionStatus(
  userId: string,
  status: SessionStatus,
  ttlMs = status.isActive ? SESSION_STATUS_TTL_MS : SESSION_INACTIVE_TTL_MS,
): Promise<void> {
  setCachedSessionStatus(userId, status, ttlMs)
  try {
    const redis = await getRedis()
    if (!redis) return
    const ex = Math.max(1, Math.ceil(ttlMs / 1000))
    await redis.set(`${REDIS_KEY_PREFIX}${userId}`, JSON.stringify(status), { ex })
  } catch {
    // fail-open: memory still updated for this process
  }
}

/**
 * Mark a user's sessions as requiring revalidation.
 * When `isActive` is false, the inactive marker is retained for the full
 * inactive TTL so middleware/API deny access until reactivation.
 */
export async function invalidateUserSessions(
  userId: string,
  hint: { isActive?: boolean; role?: string; actsAsTechnician?: boolean } = {},
): Promise<void> {
  if (!userId) return
  const status: SessionStatus = {
    isActive: hint.isActive ?? false,
    role: hint.role ?? '',
    actsAsTechnician: Boolean(hint.actsAsTechnician),
    invalidatedAt: Date.now(),
  }
  await publishSessionStatus(userId, status)
}

/**
 * Decide whether a JWT session is still allowed.
 * Cache miss → allow (fail-open). Cached inactive → deny.
 */
export async function evaluateSessionAccess(
  userId: string,
  jwtRole?: string | null,
): Promise<{
  allowed: boolean
  status: SessionStatus | null
  roleChanged: boolean
  effectiveRole: string | null
}> {
  const status = await lookupSessionStatus(userId)
  if (!status) {
    return { allowed: true, status: null, roleChanged: false, effectiveRole: null }
  }
  if (!status.isActive) {
    return { allowed: false, status, roleChanged: false, effectiveRole: null }
  }
  const roleChanged = Boolean(status.role && jwtRole && status.role !== jwtRole)
  return {
    allowed: true,
    status,
    roleChanged,
    effectiveRole: roleChanged ? status.role : null,
  }
}
