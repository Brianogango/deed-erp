import type { RepairStatus } from '@/lib/repair-types'

/**
 * Canonical operational state machine for Repair.
 *
 * Billing, payment, procurement and accounting states are deliberately absent.
 * Those modules may be linked to a Repair, but they never become Repair status.
 */
export const REPAIR_TRANSITIONS: Readonly<Record<string, readonly RepairStatus[]>> = {
  pending_verification: ['received', 'cancelled'],
  received: ['assigned', 'cancelled'],
  assigned: ['diagnosed', 'in_repair', 'unrepairable', 'cancelled'],
  diagnosed: ['awaiting_approval', 'in_repair', 'unrepairable', 'returned', 'retained', 'cancelled'],
  awaiting_approval: ['approved', 'declined', 'returned', 'retained', 'cancelled'],
  declined: ['diagnosed', 'awaiting_approval', 'returned', 'retained'],
  approved: ['awaiting_parts', 'in_repair', 'cancelled'],
  awaiting_parts: ['in_repair', 'cancelled'],
  in_repair: ['qc', 'awaiting_parts', 'unrepairable', 'cancelled'],
  qc: ['ready', 'in_repair'],
  ready: ['verified_released', 'delivered', 'collected'],
  verified_released: ['ready', 'delivered', 'collected'],
  delivered: ['closed'],
  collected: ['closed'],
  unrepairable: ['returned', 'retained'],
  returned: [],
  retained: [],
  closed: [],
  cancelled: [],

  // Legacy compatibility only. New code must never write this status: invoice
  // lifecycle is independent of workshop lifecycle.
  invoiced: ['verified_released', 'delivered', 'collected'],
}

export type RepairTransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

export function evaluateRepairTransition(
  current: RepairStatus | string,
  next: RepairStatus | string,
): RepairTransitionDecision {
  if (current === next) return { allowed: true }
  const allowed = REPAIR_TRANSITIONS[String(current)] ?? []
  if (allowed.includes(next as RepairStatus)) return { allowed: true }
  return {
    allowed: false,
    reason: `Invalid Repair transition: ${String(current)} → ${String(next)}`,
  }
}

export function canTransitionRepair(
  current: RepairStatus | string,
  next: RepairStatus | string,
): boolean {
  return evaluateRepairTransition(current, next).allowed
}

export function isRepairOperationalStatus(status: unknown): boolean {
  return String(status) !== 'invoiced'
}
