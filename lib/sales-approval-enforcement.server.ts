import 'server-only'
import type { ApprovalType } from '@/lib/sales-flow-types'

/**
 * Sales confirmation approvals (special pricing, backorder, discount, credit)
 * are disabled — confirmation proceeds without role gates.
 * Helpers below are retained for Settings / diagnostics compatibility.
 */

export function maxLineDiscountPercent(lines: any[]): number {
  return lines.reduce((max, line) => Math.max(max, Number(line.discount ?? line.discountPercent ?? 0)), 0)
}

export async function creditOverrideDetails(
  _clientId: string | undefined,
  _orderTotal: number,
  _body: any,
): Promise<{ creditRequested: number; creditAvailable: number } | null> {
  return null
}

export async function collectApprovalTriggers(
  _body: any,
  _existing?: any,
): Promise<Array<{ type: ApprovalType; details: Record<string, unknown> }>> {
  return []
}

export type ApprovalEnforcementResult =
  | { ok: true }
  | { ok: false; status: number; error: string; requiredRoles: string[] }

/**
 * No-op: sales order writes are no longer blocked by approval thresholds.
 */
export async function enforceSaleOrderApprovals(_opts: {
  body: any
  existing?: any
  sessionUserId: string
  sessionRole: string
  fromStatus: string
  toStatus: string
}): Promise<ApprovalEnforcementResult> {
  return { ok: true }
}
