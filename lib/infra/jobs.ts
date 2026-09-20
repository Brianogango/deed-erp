import 'server-only'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { enqueueJob } from '@/lib/infra/queue'

export type DurableJobStatus = 'queued' | 'running' | 'retrying' | 'completed' | 'failed'

export type EnqueueDurableJobInput = {
  type: string
  payload?: unknown
  queue?: string
  uniqueKey?: string
  runAt?: Date
  maxAttempts?: number
}

const REDIS_QUEUE = 'jobs'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function enqueueDurableJob(input: EnqueueDurableJobInput) {
  const now = new Date()
  const queue = input.queue || 'default'
  const payload = input.payload ?? {}
  const uniqueKey = input.uniqueKey || null

  if (uniqueKey) {
    const existing = await prisma.backgroundJob.findUnique({ where: { uniqueKey } })
    if (existing && (existing.status === 'queued' || existing.status === 'retrying' || existing.status === 'running')) {
      return existing
    }
    if (existing) {
      const reused = await prisma.backgroundJob.update({
        where: { id: existing.id },
        data: {
          type: input.type,
          queue,
          payload: payload as object,
          status: 'queued',
          attempts: 0,
          maxAttempts: input.maxAttempts ?? existing.maxAttempts,
          runAt: input.runAt ?? now,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          completedAt: null,
        },
      })
      await enqueueJob(REDIS_QUEUE, { id: reused.id, type: reused.type, payload: asRecord(reused.payload) }).catch(() => {})
      return reused
    }
  }

  const created = await prisma.backgroundJob.create({
    data: {
      id: randomUUID(),
      type: input.type,
      queue,
      payload: payload as object,
      status: 'queued',
      uniqueKey,
      maxAttempts: input.maxAttempts ?? 5,
      runAt: input.runAt ?? now,
    },
  })
  await enqueueJob(REDIS_QUEUE, { id: created.id, type: created.type, payload: asRecord(created.payload) }).catch(() => {})
  return created
}

type ClaimedJob = {
  id: string
  type: string
  queue: string
  payload: unknown
  status: string
  uniqueKey: string | null
  attempts: number
  maxAttempts: number
}

export async function claimDurableJobs(limit = 8, workerId = `pid-${process.pid}`): Promise<ClaimedJob[]> {
  const claimed: ClaimedJob[] = []
  const cap = Math.max(1, Math.min(limit, 20))
  for (let i = 0; i < cap; i += 1) {
    const rows = await prisma.$queryRaw<ClaimedJob[]>`
      UPDATE background_jobs
      SET
        status = 'running',
        locked_at = NOW(),
        locked_by = ${workerId},
        attempts = attempts + 1,
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM background_jobs
        WHERE status IN ('queued', 'retrying')
          AND run_at <= NOW()
        ORDER BY run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, queue, payload, status, unique_key AS "uniqueKey", attempts, max_attempts AS "maxAttempts"
    `
    if (!rows.length) break
    claimed.push(rows[0])
  }
  return claimed
}

export async function completeDurableJob(id: string) {
  return prisma.backgroundJob.update({
    where: { id },
    data: {
      status: 'completed',
      completedAt: new Date(),
      lockedAt: null,
      lastError: null,
    },
  })
}

export async function failDurableJob(id: string, error: string, opts?: { attempts: number; maxAttempts: number }) {
  const retry = opts && opts.attempts < opts.maxAttempts
  const minutes = [1, 5, 15, 60, 180][Math.min(Math.max((opts?.attempts || 1) - 1, 0), 4)]
  return prisma.backgroundJob.update({
    where: { id },
    data: {
      status: retry ? 'retrying' : 'failed',
      lastError: error.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
      runAt: retry ? new Date(Date.now() + minutes * 60_000) : new Date(),
      completedAt: retry ? null : new Date(),
    },
  })
}
