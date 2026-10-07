import { REPAIR_TRANSITIONS, evaluateRepairTransition } from '@/lib/repair-transition-policy'

/**
 * Server-side enforcement of the Repair state machine.
 *
 * REPAIR_TRANSITIONS is documented as canonical but was only ever consulted in
 * the browser, so a direct PATCH — or a stale tab replaying one — could move a
 * job straight from `received` to `collected`, skipping diagnosis, customer
 * approval, QC and the release gate, and the mirror would write that to the
 * relational enum without complaint.
 *
 * Enforcement is deliberately staged. Blocking every illegal transition on day
 * one would reject whatever undocumented-but-working moves the workshop
 * actually relies on, so only arrivals at the statuses that carry real
 * consequence are refused:
 *
 *   ready / verified_released / delivered / collected / closed
 *
 * Those are the ones that assert the device passed QC and left the building.
 * Every other illegal transition is allowed through and logged, so the real
 * traffic is visible before the guard is tightened. Widen GUARDED_TARGETS once
 * the logs are quiet.
 */
const GUARDED_TARGETS: ReadonlySet<string> = new Set([
  'ready',
  'verified_released',
  'delivered',
  'collected',
  'closed',
])

function isKnownStatus(status: unknown): boolean {
  return typeof status === 'string' && Object.hasOwn(REPAIR_TRANSITIONS, status)
}

/**
 * Returns an error message when this status change must be refused, or null.
 *
 * Unknown statuses on either side are left alone: the map cannot judge them,
 * and guessing would reject legitimate legacy rows.
 */
export function repairTransitionWriteError(
  next: { status?: unknown; ref?: unknown },
  previous?: { status?: unknown } | null,
  log: (message: string) => void = console.warn,
): string | null {
  const from = previous?.status
  const to = next?.status
  if (!previous || from === to) return null
  if (!isKnownStatus(from) || !isKnownStatus(to)) return null

  const decision = evaluateRepairTransition(from as string, to as string)
  if (decision.allowed) return null

  const ref = String(next?.ref ?? 'unknown')
  if (!GUARDED_TARGETS.has(to as string)) {
    log(`[repair-transition] allowed-but-irregular ${ref}: ${from} → ${to}`)
    return null
  }

  log(`[repair-transition] refused ${ref}: ${from} → ${to}`)
  return `Cannot move this repair from "${String(from).replace(/_/g, ' ')}" to "${String(to).replace(/_/g, ' ')}" — the workshop steps in between have not been completed.`
}

/**
 * Observe the status changes arriving in a wholesale store write.
 *
 * The guard above runs on PATCH /api/repairs/[id], which only assignment and
 * diagnosis call. Every other status change in the app — QC pass, mark ready,
 * deliver, close, unrepairable, the progress stepper — reaches the server as
 * part of the deed_repairs_v2 array through POST /api/store, which never
 * consulted it. So the traffic the staging plan was written to observe has
 * never been observed, and the logs staying quiet meant nothing.
 *
 * This deliberately only logs. Refusing here would reject whatever the
 * workshop actually does the moment it is switched on, and there is no
 * evidence yet that REPAIR_TRANSITIONS matches real practice — gathering that
 * evidence is the point. `would-refuse` marks the ones that a future
 * enforcement pass would block, so the decision can be made from data.
 */
const OBSERVE_LOG_LIMIT = 20

export function observeRepairTransitions(
  current: unknown,
  incoming: unknown,
  log: (message: string) => void = console.warn,
): { checked: number; irregular: number; wouldRefuse: number } {
  const result = { checked: 0, irregular: 0, wouldRefuse: 0 }
  if (!Array.isArray(current) || !Array.isArray(incoming)) return result

  const before = new Map<string, unknown>()
  for (const row of current) {
    const id = (row as { id?: unknown })?.id
    if (typeof id === 'string' && id) before.set(id, (row as { status?: unknown }).status)
  }

  let logged = 0
  for (const row of incoming) {
    const record = row as { id?: unknown; ref?: unknown; status?: unknown }
    const id = typeof record?.id === 'string' ? record.id : ''
    if (!id || !before.has(id)) continue

    const from = before.get(id)
    const to = record.status
    if (from === to) continue
    if (!isKnownStatus(from) || !isKnownStatus(to)) continue

    result.checked += 1
    if (evaluateRepairTransition(from as string, to as string).allowed) continue

    const guarded = GUARDED_TARGETS.has(to as string)
    if (guarded) result.wouldRefuse += 1
    else result.irregular += 1

    if (logged < OBSERVE_LOG_LIMIT) {
      logged += 1
      log(
        `[repair-transition] ${guarded ? 'would-refuse' : 'irregular'} via store `
        + `${String(record.ref ?? id)}: ${String(from)} → ${String(to)}`,
      )
    }
  }

  if (logged === OBSERVE_LOG_LIMIT) {
    log(`[repair-transition] …further transitions in this write not logged`)
  }
  return result
}
