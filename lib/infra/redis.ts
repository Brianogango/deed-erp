import 'server-only'

/**
 * Process Redis used for cache and queues.
 *
 * Backends, in order:
 * 1. REDIS_URL — TCP Redis (self-hosted)
 * 2. UPSTASH_REDIS_REST_URL + TOKEN — Upstash REST
 * 3. in-memory Map — tests, local dev, and fail-open when Redis is down
 *
 * Edge middleware must not import this module (it uses Node `net`).
 * Session validity and rate limits keep their own Edge-safe Upstash clients.
 */

export type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<void>
  incr(key: string): Promise<number>
  lpush(key: string, value: string): Promise<number>
  rpop(key: string): Promise<string | null>
  llen(key: string): Promise<number>
  ping(): Promise<boolean>
}

export type RedisBackendName = 'memory' | 'upstash' | 'redis'

type MemEntry = { value: string; expiresAt: number | null }

const memStrings = new Map<string, MemEntry>()
const memLists = new Map<string, string[]>()
let lastPrune = Date.now()

function now() {
  return Date.now()
}

function pruneMem(t = now()) {
  if (t - lastPrune < 30_000) return
  lastPrune = t
  for (const [key, entry] of memStrings) {
    if (entry.expiresAt != null && entry.expiresAt < t) memStrings.delete(key)
  }
}

function memGetRaw(key: string): string | null {
  pruneMem()
  const entry = memStrings.get(key)
  if (!entry) return null
  if (entry.expiresAt != null && entry.expiresAt < now()) {
    memStrings.delete(key)
    return null
  }
  return entry.value
}

export function createMemoryRedis(): RedisLike {
  return {
    async get(key) {
      return memGetRaw(key)
    },
    async set(key, value, ttlSeconds) {
      memStrings.set(key, {
        value,
        expiresAt: ttlSeconds && ttlSeconds > 0 ? now() + ttlSeconds * 1000 : null,
      })
    },
    async setNx(key, value, ttlSeconds) {
      if (memGetRaw(key) != null) return false
      memStrings.set(key, {
        value,
        expiresAt: ttlSeconds > 0 ? now() + ttlSeconds * 1000 : null,
      })
      return true
    },
    async del(key) {
      memStrings.delete(key)
      memLists.delete(key)
    },
    async incr(key) {
      const next = Number(memGetRaw(key) || '0') + 1
      const prev = memStrings.get(key)
      memStrings.set(key, {
        value: String(next),
        expiresAt: prev?.expiresAt ?? null,
      })
      return next
    },
    async lpush(key, value) {
      const list = memLists.get(key) || []
      list.unshift(value)
      memLists.set(key, list)
      return list.length
    },
    async rpop(key) {
      const list = memLists.get(key)
      if (!list || list.length === 0) return null
      const value = list.pop() ?? null
      if (list.length === 0) memLists.delete(key)
      return value
    },
    async llen(key) {
      return memLists.get(key)?.length ?? 0
    },
    async ping() {
      return true
    },
  }
}

function encodeCommand(args: string[]): Buffer {
  let out = `*${args.length}\r\n`
  for (const arg of args) {
    const bytes = Buffer.byteLength(arg)
    out += `$${bytes}\r\n${arg}\r\n`
  }
  return Buffer.from(out)
}

type RedisValue = string | number | null

function parseOne(buf: Buffer, start: number): { value: RedisValue; next: number } | null {
  if (buf.length <= start) return null
  const type = buf[start]
  const headerEnd = buf.indexOf('\r\n', start)
  if (headerEnd < 0) return null
  const header = buf.subarray(start + 1, headerEnd).toString('utf8')

  if (type === 43 /* + */) return { value: header, next: headerEnd + 2 }
  if (type === 45 /* - */) throw new Error(`Redis error: ${header}`)
  if (type === 58 /* : */) return { value: Number(header), next: headerEnd + 2 }
  if (type === 36 /* $ */) {
    const len = Number(header)
    if (len < 0) return { value: null, next: headerEnd + 2 }
    const bodyStart = headerEnd + 2
    const bodyEnd = bodyStart + len
    if (buf.length < bodyEnd + 2) return null
    return { value: buf.subarray(bodyStart, bodyEnd).toString('utf8'), next: bodyEnd + 2 }
  }
  throw new Error(`Unsupported Redis reply type ${String.fromCharCode(type)}`)
}

function parseRedisUrl(urlString: string): { host: string; port: number; password?: string; db?: number } {
  const url = new URL(urlString)
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://')
  }
  const dbPath = url.pathname.replace(/^\//, '')
  const db = dbPath ? Number(dbPath) : undefined
  return {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 6379,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(db) ? db : undefined,
  }
}

async function createTcpRedis(urlString: string): Promise<RedisLike> {
  const net = await import('node:net')
  const tls = await import('node:tls')
  const parsed = parseRedisUrl(urlString)
  const useTls = urlString.startsWith('rediss://')

  let buffer = Buffer.alloc(0)
  const pending: Array<{ resolve: (v: RedisValue) => void; reject: (e: Error) => void }> = []

  const socket = await new Promise<import('node:net').Socket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 4_000)
    const conn = useTls
      ? tls.connect({ host: parsed.host, port: parsed.port, servername: parsed.host })
      : net.connect({ host: parsed.host, port: parsed.port })
    conn.once('connect', () => {
      clearTimeout(timeout)
      resolve(conn)
    })
    conn.once('error', err => {
      clearTimeout(timeout)
      reject(err)
    })
  })

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (pending.length) {
      try {
        const parsedValue = parseOne(buffer, 0)
        if (!parsedValue) return
        buffer = buffer.subarray(parsedValue.next)
        pending.shift()!.resolve(parsedValue.value)
      } catch (err) {
        pending.shift()!.reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
  })

  socket.on('error', err => {
    while (pending.length) pending.shift()!.reject(err)
  })

  const send = (args: string[]) =>
    new Promise<RedisValue>((resolve, reject) => {
      pending.push({ resolve, reject })
      socket.write(encodeCommand(args))
    })

  if (parsed.password) await send(['AUTH', parsed.password])
  if (parsed.db != null && parsed.db > 0) await send(['SELECT', String(parsed.db)])

  return {
    async get(key) {
      const value = await send(['GET', key])
      return value == null ? null : String(value)
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds && ttlSeconds > 0) await send(['SET', key, value, 'EX', String(ttlSeconds)])
      else await send(['SET', key, value])
    },
    async setNx(key, value, ttlSeconds) {
      const result = await send(['SET', key, value, 'EX', String(ttlSeconds), 'NX'])
      return result === 'OK'
    },
    async del(key) {
      await send(['DEL', key])
    },
    async incr(key) {
      const value = await send(['INCR', key])
      return Number(value || 0)
    },
    async lpush(key, value) {
      return Number(await send(['LPUSH', key, value]) || 0)
    },
    async rpop(key) {
      const value = await send(['RPOP', key])
      return value == null ? null : String(value)
    },
    async llen(key) {
      return Number(await send(['LLEN', key]) || 0)
    },
    async ping() {
      const value = await send(['PING'])
      return String(value).toUpperCase() === 'PONG' || value === 'PONG'
    },
  }
}

async function createUpstashRedis(): Promise<RedisLike> {
  const { Redis } = await import('@upstash/redis')
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
  return {
    async get(key) {
      const value = await redis.get<string | number>(key)
      return value == null ? null : String(value)
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds && ttlSeconds > 0) await redis.set(key, value, { ex: ttlSeconds })
      else await redis.set(key, value)
    },
    async setNx(key, value, ttlSeconds) {
      const result = await redis.set(key, value, { ex: ttlSeconds, nx: true })
      return result === 'OK'
    },
    async del(key) {
      await redis.del(key)
    },
    async incr(key) {
      return redis.incr(key)
    },
    async lpush(key, value) {
      return redis.lpush(key, value)
    },
    async rpop(key) {
      const value = await redis.rpop<string>(key)
      return value == null ? null : String(value)
    },
    async llen(key) {
      return redis.llen(key)
    },
    async ping() {
      const value = await redis.ping()
      return String(value).toUpperCase() === 'PONG'
    },
  }
}

let cached: { backend: RedisBackendName; client: RedisLike } | null = null
let connecting: Promise<{ backend: RedisBackendName; client: RedisLike }> | null = null

function memoryBundle() {
  return { backend: 'memory' as const, client: createMemoryRedis() }
}

export function __resetInfraRedisForTests() {
  memStrings.clear()
  memLists.clear()
  lastPrune = Date.now()
  cached = { backend: 'memory', client: createMemoryRedis() }
  connecting = null
}

export function __setInfraRedisForTests(client: RedisLike, backend: RedisBackendName = 'memory') {
  cached = { backend, client }
  connecting = null
}

async function connect(): Promise<{ backend: RedisBackendName; client: RedisLike }> {
  const redisUrl = String(process.env.REDIS_URL || '').trim()
  if (redisUrl) {
    try {
      const client = await createTcpRedis(redisUrl)
      await client.ping()
      return { backend: 'redis', client }
    } catch (err) {
      console.warn('[infra-redis] REDIS_URL failed; using memory fallback:', err instanceof Error ? err.message : err)
    }
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const client = await createUpstashRedis()
      await client.ping()
      return { backend: 'upstash', client }
    } catch (err) {
      console.warn('[infra-redis] Upstash failed; using memory fallback:', err instanceof Error ? err.message : err)
    }
  }

  return memoryBundle()
}

export async function getInfraRedis(): Promise<RedisLike> {
  if (cached) return cached.client
  if (!connecting) {
    connecting = connect().then(bundle => {
      cached = bundle
      connecting = null
      return bundle
    }).catch(err => {
      connecting = null
      const fallback = memoryBundle()
      cached = fallback
      console.warn('[infra-redis] connect failed; memory fallback:', err instanceof Error ? err.message : err)
      return fallback
    })
  }
  return (await connecting).client
}

export async function infraRedisBackend(): Promise<RedisBackendName> {
  await getInfraRedis()
  if (!cached) return 'memory'
  return cached.backend
}

/** Exported for unit tests of the RESP codec. */
export const __redisTest = {
  encodeCommand,
  parseOne,
  parseRedisUrl,
  createMemoryRedis,
}
