/**
 * Company-mistake / no-charge repair billing.
 *
 * Use when Deed caused the issue (wrong repair, comeback, our error) and the
 * job must not go through customer quote approval or invoicing.
 *
 * Distinct from warranty (customer entitlement) and Direct Repair (customer
 * declined diagnosis). Requires a manager, a typed reason, and an audit log.
 */

export type BillingExemptReason = 'company_mistake' | 'goodwill' | 'other'

export const BILLING_EXEMPT_REASON_LABELS: Record<BillingExemptReason, string> = {
  company_mistake: 'Company mistake / rework',
  goodwill: 'Goodwill / courtesy',
  other: 'Other (see notes)',
}

export type BillingExemptRepair = {
  billingExempt?: boolean | null
  billingExemptReason?: BillingExemptReason | string | null
  underWarranty?: boolean | null
  warrantyCoverage?: string | null
  repairPath?: string | null
  status?: string | null
}

const MANAGER_ROLES = ['director', 'admin_officer', 'technical_lead', 'finance_officer'] as const

export function normalizeBillingExemptReason(value: unknown): BillingExemptReason {
  if (value === 'goodwill' || value === 'other' || value === 'company_mistake') return value
  return 'company_mistake'
}

/** True when this job must skip customer quote gates and invoicing. */
export function isRepairBillingExempt(repair: BillingExemptRepair | null | undefined): boolean {
  return !!repair?.billingExempt
}

/** Full warranty already covers no-charge — keep that path separate. */
export function isRepairNoCharge(repair: BillingExemptRepair | null | undefined): boolean {
  if (isRepairBillingExempt(repair)) return true
  return !!repair?.underWarranty && repair.warrantyCoverage === 'full'
}

export function canApplyBillingExempt(role: string | null | undefined): boolean {
  return MANAGER_ROLES.includes((role ?? '') as (typeof MANAGER_ROLES)[number])
}

const TERMINAL = new Set([
  'closed', 'cancelled', 'returned', 'retained', 'unrepairable', 'delivered', 'collected', 'invoiced',
])

/** Managers may mark an open (non-terminal) job as no-charge. */
export function canMarkRepairBillingExempt(
  role: string | null | undefined,
  repair: BillingExemptRepair | null | undefined,
): boolean {
  if (!repair || !canApplyBillingExempt(role)) return false
  if (isRepairBillingExempt(repair)) return false
  if (TERMINAL.has(String(repair.status ?? ''))) return false
  return true
}

/**
 * Statuses from which work may start when billing is exempt
 * (no customer quote approval required).
 */
export function startableStatusesWhenBillingExempt(): string[] {
  return ['assigned', 'diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'declined']
}

export function billingExemptLabel(repair: BillingExemptRepair | null | undefined): string {
  if (!isRepairBillingExempt(repair)) return ''
  const reason = normalizeBillingExemptReason(repair?.billingExemptReason)
  return BILLING_EXEMPT_REASON_LABELS[reason]
}
