import 'server-only'
import { claimDurableJobs, completeDurableJob, failDurableJob } from '@/lib/infra/jobs'
import { dequeueJobs } from '@/lib/infra/queue'
import { refreshCoreReportSnapshots } from '@/lib/infra/report-snapshots'

async function runJob(type: string, payload: unknown) {
  if (type === 'refresh_core_reports' || type === 'refresh_report_snapshot') {
    return refreshCoreReportSnapshots()
  }
  throw new Error(`Unknown background job type: ${type}`)
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
      await failDurableJob(job.id, message, { attempts: job.attempts, maxAttempts: job.maxAttempts }).catch(() => {})
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
