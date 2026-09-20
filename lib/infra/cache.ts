import 'server-only'
import { getInfraRedis } from '@/lib/infra/redis'

const KEY_PREFIX = 'deed:cache:'

export function cacheKey(parts: Array<string | number | null | undefined>): string {
  return KEY_PREFIX + parts.map(part => String(part ?? '')).join(':')
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = await getInfraRedis()
    const raw = await redis.get(key)
    if (raw == null) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const redis = await getInfraRedis()
    await redis.set(key, JSON.stringify(value), Math.max(1, ttlSeconds))
  } catch {
    // fail-open — callers still have the live path
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const redis = await getInfraRedis()
    await redis.del(key)
  } catch {
    // ignore
  }
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<{ value: T; source: 'cache' | 'live' }> {
  const cached = await cacheGet<T>(key)
  if (cached != null) return { value: cached, source: 'cache' }
  const value = await load()
  await cacheSet(key, value, ttlSeconds)
  return { value, source: 'live' }
}

export async function cacheIncr(key: string): Promise<number> {
  const redis = await getInfraRedis()
  return redis.incr(key)
}
