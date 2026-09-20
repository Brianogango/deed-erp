import 'server-only'
import { randomUUID } from 'node:crypto'
import { getInfraRedis } from '@/lib/infra/redis'

export type QueueJob<T = unknown> = {
  id: string
  type: string
  payload: T
  attempts: number
  enqueuedAt: string
  runAt?: string
}

const QUEUE_PREFIX = 'deed:queue:'

export function queueRedisKey(name: string): string {
  return `${QUEUE_PREFIX}${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
}

export async function enqueueJob<T>(
  queue: string,
  input: {
    type: string
    payload: T
    id?: string
    attempts?: number
    runAt?: string
  },
): Promise<QueueJob<T>> {
  const job: QueueJob<T> = {
    id: input.id || randomUUID(),
    type: input.type,
    payload: input.payload,
    attempts: input.attempts ?? 0,
    enqueuedAt: new Date().toISOString(),
    runAt: input.runAt,
  }
  const redis = await getInfraRedis()
  await redis.lpush(queueRedisKey(queue), JSON.stringify(job))
  return job
}

export async function dequeueJob<T = unknown>(queue: string): Promise<QueueJob<T> | null> {
  const redis = await getInfraRedis()
  const raw = await redis.rpop(queueRedisKey(queue))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as QueueJob<T>
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.type) return null
    return parsed
  } catch {
    return null
  }
}

export async function dequeueJobs<T = unknown>(queue: string, limit: number): Promise<Array<QueueJob<T>>> {
  const jobs: Array<QueueJob<T>> = []
  const cap = Math.max(0, Math.min(limit, 50))
  for (let i = 0; i < cap; i += 1) {
    const job = await dequeueJob<T>(queue)
    if (!job) break
    jobs.push(job)
  }
  return jobs
}

export async function queueLength(queue: string): Promise<number> {
  const redis = await getInfraRedis()
  return redis.llen(queueRedisKey(queue))
}

export async function requeueJob<T>(queue: string, job: QueueJob<T>, error?: string): Promise<QueueJob<T>> {
  return enqueueJob(queue, {
    id: job.id,
    type: job.type,
    payload: { ...(job.payload as object), lastError: error } as T,
    attempts: job.attempts + 1,
    runAt: job.runAt,
  })
}
