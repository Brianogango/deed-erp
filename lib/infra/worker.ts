import 'server-only'
import { claimDurableJobs, completeDurableJob, failDurableJob } from '@/lib/infra/jobs'
import { dequeueJobs } from '@/lib/infra/queue'
import { refreshCoreReportSnapshots } from '@/lib/infra/report-snapshots'
import { MIRROR_STORE_KEY_JOB, runMirrorStoreKeyJob } from '@/lib/store-mirror-jobs'
import { STORE_PARITY_JOB, runStoreParityJob } from '@/lib/store-parity'
import { INVOICE_POSTING_JOB, runInvoicePostingRetry } from '@/lib/invoice-posting-jobs'

async function runJob(type: string, payload: unknown) {
  if (type === 'refresh_core_reports' || type === 'refresh_report_snapshot') {
    return refreshCoreReportSnapshots()
  }
  // Re-run a Prisma mirror that failed during a save (KI-01). Throwing here
  // is what schedules the next attempt with backoff.
  if (type === MIRROR_STORE_KEY_JOB) {
    return runMirrorStoreKeyJob(payload)
  }
  // Compare the legacy copy against the Prisma projection and alert on drift.
  if (type === STORE_PARITY_JOB) {
    return runStoreParityJob(payload)
  }
  // Re-post an invoice whose GL journal failed after its confirm committed.
  if (type === INVOICE_POSTING_JOB) {
    return runInvoicePostingRetry(payload)
  }
  throw new Error(`Unknown background job type: ${type}`)
}

async function alertMirrorExhausted(payload: unknown, error: string) {
  const key = String((payload as { key?: unknown } | null)?.key ?? 'unknown')
  const { publishNotificationEvent } = await import('@/lib/notifications/service')
  await publishNotificationEvent({
    eventType: 'store_mirror_exhausted',
    entityType: 'store_mirror',
    entityId: key,
    severity: 'critical',
    title: `Prisma mirror for ${key} gave up after repeated failures`,
    body:
      `Saves to ${key} are committed, but the Prisma copy of them could not be written `
      + `after every retry. Reports built from Prisma will be behind the screens until this `
      + `is repaired.\n\nLast error: ${error}`,
    actionUrl: '/settings',
    idempotencyKey: `store-mirror-exhausted:${key}`,
  })
}

export async function runInfraWorker(limit = 8) {
  const redisJobs = await dequeueJobs('jobs', limit).catch(() => [])
  const durable = await claimDurableJobs(limit).catch(() => [])
  const processed: Array<{ id: string; type: string; ok: boolean; error?: string }> = []

  const seen = new Set<string>()

  for (const job of durable) {
    seen.add(job.id)
    try {
      await runJob(job.type, job.payload)
      await completeDurableJob(job.id)
      processed.push({ id: job.id, type: job.type, ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failed = await failDurableJob(job.id, message, { attempts: job.attempts, maxAttempts: job.maxAttempts }).catch(() => null)
      // A mirror that has run out of retries will not fix itself: that key is
      // now knowingly behind and needs a person. Alert once per key.
      if (failed?.status === 'failed' && job.type === MIRROR_STORE_KEY_JOB) {
        await alertMirrorExhausted(job.payload, message).catch(() => {})
      }
      processed.push({ id: job.id, type: job.type, ok: false, error: message })
    }
  }

  for (const job of redisJobs) {
    if (seen.has(job.id)) continue
    try {
      await runJob(job.type, job.payload)
      processed.push({ id: job.id, type: job.type, ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      processed.push({ id: job.id, type: job.type, ok: false, error: message })
    }
  }

  return {
    processed: processed.length,
    succeeded: processed.filter(job => job.ok).length,
    failed: processed.filter(job => !job.ok).length,
    jobs: processed,
  }
}
