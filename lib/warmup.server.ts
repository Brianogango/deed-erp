/**
 * Build the big read-model caches when a worker starts, before it serves.
 *
 * Each PM2 worker keeps its own caches. After a deploy or restart the first
 * people to open a screen used to pay for building them (0.3–0.9 s each,
 * several at once), and while a worker was busy building, every other request
 * on it waited too — the "slow GET … 0KB" lines with seconds spent on tiny
 * checks. Now the worker builds them first and only then tells PM2 it is
 * ready (ecosystem.config.js: wait_ready), so during a reload the old worker
 * keeps serving until the new one is warm.
 */
import { withSharedReadModels } from '@/lib/read-model-cache'

// One at a time: the worker is not serving yet, and the database is shared
// with the worker that still is.
const GROUPS: string[][] = [
  ['deed_invoices'],
  ['deed_saleOrders'],
  ['deed_repairs_v2'],
  ['deed_quotes'],
  ['deed_contacts'],
  ['deed_products', 'deed_serials', 'deed_bulkStock'],
  ['deed_purchaseOrders'],
  ['deed_deposits'],
  ['deed_accounts'],
]

let started = false

export async function warmReadModels(): Promise<void> {
  if (started) return
  started = true
  const t0 = Date.now()
  const timings: string[] = []
  try {
    const { loadAppState } = await import('@/lib/server-store')
    for (const keys of GROUPS) {
      const t = Date.now()
      try {
        await withSharedReadModels(() => loadAppState(keys))
      } catch (err) {
        console.warn(`[warmup] ${keys.join(',')} failed:`, err instanceof Error ? err.message : err)
      }
      timings.push(`${keys[0].replace('deed_', '')} ${Date.now() - t}`)
    }
    try {
      const { loadBrowserJournals } = await import('@/lib/journal-read-model.server')
      const t = Date.now()
      await loadBrowserJournals()
      timings.push(`journals ${Date.now() - t}`)
    } catch { /* built on first use instead */ }
  } finally {
    console.log(`[warmup] caches ready in ${Date.now() - t0}ms: ${timings.join(', ')}`)
    signalReady()
  }
}

/** Tells PM2 (wait_ready) this worker may take traffic. Harmless elsewhere. */
export function signalReady(): void {
  try {
    if (typeof process.send === 'function') process.send('ready')
  } catch { /* not under PM2 */ }
}

/** Called from instrumentation.ts when a worker starts. */
export function startWarmup(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.DEED_WARMUP === '0') {
    signalReady()
    return
  }
  // Not awaited: the worker listens at once (health checks answer), and PM2
  // waits for the ready signal before retiring the old worker.
  setTimeout(() => { void warmReadModels() }, 500)
}
