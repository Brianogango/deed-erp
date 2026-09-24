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
export const GUARDED_TARGETS: ReadonlySet<string> = new Set([
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
