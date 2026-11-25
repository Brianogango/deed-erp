import 'server-only'
import { enqueueDurableJob } from '@/lib/infra/jobs'

/**
 * Durable retry for the Prisma mirror writes performed by `saveStoreKeys`.
 *
 * Before this, the delivery and purchase-order mirrors ran as
 * `void import('./delivery-mirror').then(...).catch(console.error)` and the
 * `store_records` / repair mirrors swallowed their rejection. A mirror that
 * failed was logged once and forgotten, which is the mechanism behind KI-01:
 * stock and GL rows could differ between `app_state` and Prisma with nothing
 * to detect or repair the gap. Every mirror is now attempted inline, exactly
 * as the stock/table-fed mirrors already were, and a failure enqueues a
 * `BackgroundJob` that the infra worker retries with backoff.
 *
 * The job deliberately carries only the store KEY, never the value that failed
 * to mirror. Replaying a snapshot is not merely wasteful, it is wrong: by the
 * time a retry runs, later saves may have superseded it, and writing the old
 * rows back would resurrect records the user has since changed or deleted. The
 * worker therefore re-reads whatever the store holds *now* and mirrors that.
 *
 * `uniqueKey` collapses repeated failures for one key into a single pending
 * job, so an outage that spans a thousand saves leaves one retry rather than a
 * thousand identical ones.
 */
export const MIRROR_STORE_KEY_JOB = 'mirror_store_key'

/** Store keys this module knows how to re-mirror, and which mirror to use. */
const MIRROR_TARGETS: Record<string, 'delivery' | 'known-domain' | 'repairs' | 'store-records'> = {
  deed_deliveries: 'delivery',
  deed_purchaseOrders: 'known-domain',
  deed_repairs_v2: 'repairs',
}

export function isMirrorableStoreKey(key: string): boolean {
  return key in MIRROR_TARGETS || key === STORE_RECORDS_SENTINEL
}

/**
 * `store_records` is a projection of many keys at once rather than one domain,
 * so its retry records the keys that were in the failed batch and re-reads
 * them together.
 */
export const STORE_RECORDS_SENTINEL = '__store_records__'

type EnqueueInput = { key: string; keys?: string[]; error: unknown }

/**
 * Record that a mirror failed so the worker retries it. Never throws: a save
 * that already wrote the authoritative row must not fail because the *retry
 * bookkeeping* could not be written. A lost enqueue degrades to the previous
 * behaviour (a logged error), which the parity check still catches.
 */
export async function enqueueMirrorRetry({ key, keys, error }: EnqueueInput): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[store-mirror] ${key} mirror failed, queued for retry:`, message)
  try {
    await enqueueDurableJob({
      type: MIRROR_STORE_KEY_JOB,
      queue: 'mirrors',
      uniqueKey: `${MIRROR_STORE_KEY_JOB}:${key}`,
      payload: { key, keys: keys ?? null, lastError: message.slice(0, 500) },
      maxAttempts: 6,
    })
  } catch (enqueueErr) {
    console.error(`[store-mirror] could not queue retry for ${key}:`, enqueueErr)
  }
}

/**
 * Re-run one mirror from whatever the store holds now. Called by the infra
 * worker; throwing marks the job for another attempt with backoff.
 */
export async function runMirrorStoreKeyJob(payload: unknown): Promise<{ key: string; mirrored: number }> {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const key = String(record.key || '')
  if (!key) throw new Error('mirror_store_key job has no key')

  const { loadAppStateForWrite } = await import('@/lib/server-store')

  if (key === STORE_RECORDS_SENTINEL) {
    const keys = Array.isArray(record.keys) ? record.keys.map(String).filter(Boolean) : []
    if (!keys.length) return { key, mirrored: 0 }
    const state = await loadAppStateForWrite(keys)
    const entries: Record<string, string> = {}
    for (const k of keys) {
      const value = state[k]
      if (typeof value === 'string') entries[k] = value
      else if (value !== undefined) entries[k] = JSON.stringify(value)
    }
    if (!Object.keys(entries).length) return { key, mirrored: 0 }
    const { writeStoreRecords } = await import('@/lib/prisma-store')
    await writeStoreRecords(entries)
    return { key, mirrored: Object.keys(entries).length }
  }

  const target = MIRROR_TARGETS[key]
  if (!target) throw new Error(`No mirror registered for store key ${key}`)

  const state = await loadAppStateForWrite([key])
  const raw = state[key]
  const value = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw)
  if (!value) return { key, mirrored: 0 }

  if (target === 'delivery') {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return { key, mirrored: 0 }
    const { mirrorDeliveriesToPrisma } = await import('@/lib/delivery-mirror')
    await mirrorDeliveriesToPrisma(parsed)
    return { key, mirrored: parsed.length }
  }

  if (target === 'repairs') {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return { key, mirrored: 0 }
    const { mirrorRepairsToPrisma } = await import('@/lib/repair-mirror')
    const result = await mirrorRepairsToPrisma(parsed)
    return { key, mirrored: Number((result as { mirrored?: number })?.mirrored ?? parsed.length) }
  }

  const { mirrorKnownDomain } = await import('@/lib/blob-transfer')
  const result = await mirrorKnownDomain(key, value, null)
  if (result && (result as { error?: string }).error) {
    throw new Error(String((result as { error?: string }).error))
  }
  const skipped = Number((result as { skipped?: number })?.skipped ?? 0)
  if (skipped > 0) {
    throw new Error(`${key}: ${skipped} row(s) the table could not hold`)
  }
  return { key, mirrored: Number((result as { upserted?: number })?.upserted ?? 0) }
}
