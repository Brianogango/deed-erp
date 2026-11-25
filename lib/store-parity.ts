import 'server-only'
import prisma from '@/lib/prisma'

/**
 * Store parity check: does the Prisma projection hold the same records as the
 * legacy `app_state` copy?
 *
 * This is the gate step 7 of docs/PRISMA_STATE_CUTOVER.md asks for. That step
 * is currently a pair of SQL queries an operator runs by hand and eyeballs;
 * because nothing ran it on a schedule, a mirror that silently fell behind
 * could sit undetected until a report disagreed with a screen (KI-01). The
 * same comparison now runs as a background job and raises a notification when
 * a key drifts, so `STORE_BACKEND=dual` can be certified from evidence rather
 * than from a one-off manual check.
 *
 * It only ever reads. Repairing drift is the mirror retry
 * (`lib/store-mirror-jobs.ts`), not this job.
 */
export const STORE_PARITY_JOB = 'store_parity_check'

export type StoreParityRow = {
  key: string
  appStateCount: number
  projectionCount: number
  /** projectionCount - appStateCount; negative means Prisma is behind. */
  drift: number
}

export type StoreParityResult = {
  checkedAt: string
  /** Keys present in either layer, with their counts. */
  rows: StoreParityRow[]
  /** Rows whose counts disagree. */
  drifted: StoreParityRow[]
  /** True when every compared key matched. */
  inParity: boolean
  /** False when the projection tables do not exist yet (pre-cutover step 2). */
  projectionAvailable: boolean
  alerted: boolean
}

/**
 * Count records per `deed_*` key in each layer.
 *
 * `app_state` holds one row per key whose `value` is a JSON array, so the count
 * is the array length. `erp_state_records` holds one row per business record,
 * so the count is a GROUP BY. Only keys stored as arrays are comparable —
 * scalar/settings keys are skipped rather than reported as drift.
 */
async function collectCounts(): Promise<{ app: Map<string, number>; projection: Map<string, number>; projectionAvailable: boolean }> {
  const appRows = await prisma.$queryRaw<Array<{ key: string; n: bigint | number }>>`
    SELECT key, json_array_length(value::json) AS n
      FROM app_state
     WHERE key LIKE 'deed_%' AND left(value, 1) = '['
  `
  const app = new Map<string, number>()
  for (const row of appRows) app.set(row.key, Number(row.n))

  const exists = await prisma.$queryRaw<Array<{ reg: string | null }>>`
    SELECT to_regclass('public.erp_state_records')::text AS reg
  `
  const projectionAvailable = Boolean(exists[0]?.reg)
  const projection = new Map<string, number>()
  if (projectionAvailable) {
    const projRows = await prisma.$queryRaw<Array<{ key: string; n: bigint | number }>>`
      SELECT key, COUNT(*) AS n FROM erp_state_records GROUP BY key
    `
    for (const row of projRows) projection.set(row.key, Number(row.n))
  }
  return { app, projection, projectionAvailable }
}

export async function checkStoreParity(): Promise<Omit<StoreParityResult, 'alerted'>> {
  const { app, projection, projectionAvailable } = await collectCounts()

  const rows: StoreParityRow[] = []
  for (const key of new Set([...app.keys(), ...projection.keys()])) {
    // A key the projection has never been backfilled with is not drift: before
    // the backfill (runbook step 5) every key legitimately reads 0 there.
    if (projectionAvailable && !projection.has(key) && projection.size === 0) continue
    const appStateCount = app.get(key) ?? 0
    const projectionCount = projection.get(key) ?? 0
    rows.push({ key, appStateCount, projectionCount, drift: projectionCount - appStateCount })
  }
  rows.sort((a, b) => a.key.localeCompare(b.key))

  const drifted = projectionAvailable ? rows.filter(r => r.drift !== 0) : []
  return {
    checkedAt: new Date().toISOString(),
    rows,
    drifted,
    inParity: drifted.length === 0,
    projectionAvailable,
  }
}

/**
 * Alert on drift. The idempotency key folds in the drifted key names and their
 * counts, so a standing, unchanged gap notifies once rather than on every run,
 * while a gap that grows notifies again.
 */
async function alertOnDrift(drifted: StoreParityRow[]): Promise<boolean> {
  if (!drifted.length) return false
  const summary = drifted
    .map(r => `${r.key}: copy ${r.appStateCount}, Prisma ${r.projectionCount} (${r.drift > 0 ? '+' : ''}${r.drift})`)
    .join('\n')
  const fingerprint = drifted.map(r => `${r.key}=${r.appStateCount}/${r.projectionCount}`).join(',')
  try {
    const { publishNotificationEvent } = await import('@/lib/notifications/service')
    await publishNotificationEvent({
      eventType: 'store_parity_drift',
      entityType: 'store_parity',
      entityId: 'store_parity',
      severity: 'critical',
      title: `Store parity drift on ${drifted.length} key${drifted.length === 1 ? '' : 's'}`,
      body:
        'The Prisma projection and the legacy app_state copy hold different numbers of records. '
        + 'The cutover to STORE_BACKEND=prisma must not be certified while this is true.\n\n'
        + summary,
      actionUrl: '/settings',
      metadata: { drifted } as never,
      idempotencyKey: `store-parity:${fingerprint}`.slice(0, 200),
    })
    return true
  } catch (err) {
    console.error('[store-parity] drift detected but the alert could not be published:', err)
    return false
  }
}

export async function runStoreParityJob(_payload?: unknown): Promise<StoreParityResult> {
  const report = await checkStoreParity()
  const alerted = await alertOnDrift(report.drifted)
  if (!report.inParity) {
    console.error(
      `[store-parity] ${report.drifted.length} key(s) out of parity:`,
      report.drifted.map(r => `${r.key} ${r.appStateCount}->${r.projectionCount}`).join('; '),
    )
  }
  return { ...report, alerted }
}
