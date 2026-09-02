import 'server-only'
import type { ApprovalType } from '@/lib/sales-flow-types'
import {
  extractApprovalValue,
  getApprovalRolesSync,
  isCreditOverrideApprovalRequired,
  isSpecialPricingApprovalRequired,
  rolesFromThresholds,
  type ApprovalThreshold,
} from '@/lib/sales-approval-rules'
import { loadAppState } from '@/lib/server-store'

/**
 * Prefer DB approval_rules; fall back to hardcoded APPROVAL_RULES.
 * Server-only — never import from client bundles (store / AppShell).
 *
 * Policy locks:
 * - backorder never gates confirm (even if an old DB row still lists TL)
 * - purchase_high_value never gates PO confirm (amount cap removed)
 * - special_pricing is Director OR Finance when Settings resumes it;
 *   otherwise the ladder is on hold (roles kept, confirm not blocked)
 * - credit_override is Finance (then Director above 100k) when Settings
 *   resumes it; otherwise the ladder is on hold (roles kept, confirm not blocked)
 */
async function salesConfirmApprovalSettingsFromStore(): Promise<{
  salesRequireSpecialPricingApproval?: boolean
  salesRequireCreditOverrideApproval?: boolean
}> {
  try {
    const state = await loadAppState(['deed_systemSettings'])
    return (state as any)?.deed_systemSettings ?? (state as any)?.systemSettings ?? {}
  } catch {
    return {}
  }
}

export async function getApprovalRoles(type: ApprovalType, details: any): Promise<string[]> {
  if (type === 'backorder') return []
  if (type === 'purchase_high_value') return []
  if (type === 'special_pricing') {
    if (!isSpecialPricingApprovalRequired(await salesConfirmApprovalSettingsFromStore())) return []
    return ['director', 'finance_officer']
  }
  if (type === 'credit_override') {
    if (!isCreditOverrideApprovalRequired(await salesConfirmApprovalSettingsFromStore())) return []
  }

  try {
    const { default: prisma } = await import('@/lib/prisma')
    const rule = await prisma.approvalRule.findUnique({ where: { approvalType: type } })
    if (rule?.isActive) {
      const thresholds = rule.thresholds as ApprovalThreshold[]
      const value = extractApprovalValue(type, details)
      const fromDb = rolesFromThresholds(thresholds, value)
      if (fromDb) {
        // Discount DB ladders that still list a chain collapse to any-of roles.
        if (type === 'discount' && fromDb.length > 0) {
          const uniq = [...new Set(fromDb)]
          // Ensure both Director and Finance can clear price discounts.
          if (!uniq.includes('director')) uniq.push('director')
          if (!uniq.includes('finance_officer')) uniq.push('finance_officer')
          return uniq
        }
        return fromDb
      }
    }
  } catch {
    // table missing / prisma offline — use hardcoded
  }
  return getApprovalRolesSync(type, details)
}

export async function requiresApprovalAsync(type: ApprovalType, details: any): Promise<boolean> {
  const requiredRoles = await getApprovalRoles(type, details)
  return requiredRoles.length > 0
}
