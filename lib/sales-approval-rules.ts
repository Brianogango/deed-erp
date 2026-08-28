import type { ApprovalType } from '@/lib/sales-flow-types'

export type ApprovalThreshold = { maxValue: number; requiredRoles: string[] }

/**
 * Hardcoded fallback thresholds — used when approval_rules table is missing
 * or a type has no active DB row. Keep in sync with historical APPROVAL_RULES.
 * CLIENT-SAFE: no Prisma / Node-only imports.
 *
 * Price types (`discount`, `special_pricing`) list Director + Finance as an
 * any-of set (one approval is enough). `backorder` and `purchase_high_value`
 * no longer gate confirm.
 *
 * `special_pricing` roles are kept, but confirm is on hold unless
 * `salesRequireSpecialPricingApproval` is explicitly true (below cost /
 * lowest selling point / pricelist). Do not delete this ladder.
 */
export const APPROVAL_RULES: Record<ApprovalType, (details: any) => string[]> = {
  discount: (details) => {
    const percent = details.discountPercent || 0
    if (percent <= 10) return []
    // Director OR Finance — not a sequential chain.
    return ['director', 'finance_officer']
  },
  // Roles kept for resume. Confirm gating is `isSpecialPricingApprovalRequired`.
  special_pricing: () => ['director', 'finance_officer'],
  credit_override: (details) => {
    const amount = details.creditRequested || 0
    const available = details.creditAvailable || 0
    const overage = amount - available
    if (overage <= 0) return []
    if (overage <= 100000) return ['finance_officer']
    return ['finance_officer', 'director']
  },
  corporate_deal: () => ['director'],
  // Stock shortfalls create delivery backorders; they do not need TL approval.
  backorder: () => [],
  // High-value PO director approval was removed — confirm is not amount-gated.
  purchase_high_value: () => [],
}

/** Types that can block quotation confirm. */
export const SALES_CONFIRM_APPROVAL_TYPES: ApprovalType[] = [
  'discount',
  'credit_override',
  'backorder',
  'special_pricing',
]

/**
 * Below-lowest-selling-point / below-cost / below-pricelist authorization.
 * On hold unless Settings explicitly turns it back on.
 */
export function isSpecialPricingApprovalRequired(
  settings?: { salesRequireSpecialPricingApproval?: boolean } | null,
): boolean {
  return settings?.salesRequireSpecialPricingApproval === true
}

/** Approval types that still block confirm for the current settings. */
export function salesConfirmGatingApprovalTypes(
  settings?: { salesRequireSpecialPricingApproval?: boolean } | null,
): ApprovalType[] {
  if (isSpecialPricingApprovalRequired(settings)) return [...SALES_CONFIRM_APPROVAL_TYPES]
  return SALES_CONFIRM_APPROVAL_TYPES.filter(type => type !== 'special_pricing')
}

export function isSalesConfirmGatingApproval(
  type: string,
  settings?: { salesRequireSpecialPricingApproval?: boolean } | null,
): boolean {
  return (salesConfirmGatingApprovalTypes(settings) as string[]).includes(type)
}

/** Types where any listed role may approve (single decision). */
export function approvalRolesAreAnyOf(type: ApprovalType): boolean {
  return type === 'discount' || type === 'special_pricing'
}

/** Extract the numeric value used for threshold comparison. */
export function extractApprovalValue(type: ApprovalType, details: any): number {
  switch (type) {
    case 'discount':
      return Number(details?.discountPercent || 0)
    case 'credit_override': {
      const amount = Number(details?.creditRequested || 0)
      const available = Number(details?.creditAvailable || 0)
      return Math.max(0, amount - available)
    }
    case 'backorder':
      return Number(details?.backorderQty || 0)
    case 'special_pricing':
    case 'corporate_deal':
    case 'purchase_high_value':
    default:
      return Number(details?.proposedValue ?? details?.value ?? details?.amount ?? 0)
  }
}

/** Resolve roles from DB-style thresholds; empty max ladder falls through. */
export function rolesFromThresholds(thresholds: ApprovalThreshold[], value: number): string[] | null {
  if (!Array.isArray(thresholds) || thresholds.length === 0) return null
  const sorted = [...thresholds].sort((a, b) => a.maxValue - b.maxValue)
  for (const t of sorted) {
    if (value <= t.maxValue) return t.requiredRoles ?? []
  }
  return sorted[sorted.length - 1]?.requiredRoles ?? []
}

/** Sync helper — uses hardcoded APPROVAL_RULES (no DB). */
export function getApprovalRolesSync(type: ApprovalType, details: any): string[] {
  return APPROVAL_RULES[type](details)
}

/** True when the actor's role covers the required roles for this approval type. */
export function actorSatisfiesApprovalRoles(
  type: ApprovalType,
  requiredRoles: string[],
  actorRole: string | null | undefined,
): boolean {
  if (!actorRole || requiredRoles.length === 0) return requiredRoles.length === 0
  if (approvalRolesAreAnyOf(type)) return requiredRoles.includes(actorRole)
  return requiredRoles.every(role => role === actorRole)
}
