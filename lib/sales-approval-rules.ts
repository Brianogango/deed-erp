import type { ApprovalType } from '@/lib/sales-flow-types'

export type ApprovalThreshold = { maxValue: number; requiredRoles: string[] }

/**
 * Hardcoded fallback thresholds — used when approval_rules table is missing
 * or a type has no active DB row. Keep in sync with historical APPROVAL_RULES.
 */
export const APPROVAL_RULES: Record<ApprovalType, (details: any) => string[]> = {
  discount: (details) => {
    const percent = details.discountPercent || 0
    if (percent <= 10) return []
    if (percent <= 20) return ['director']
    return ['director', 'finance_officer']
  },
  special_pricing: () => ['director'],
  credit_override: (details) => {
    const amount = details.creditRequested || 0
    const available = details.creditAvailable || 0
    const overage = amount - available
    if (overage <= 0) return []
    if (overage <= 100000) return ['finance_officer']
    return ['finance_officer', 'director']
  },
  corporate_deal: () => ['director'],
  backorder: (details) => {
    const qty = details.backorderQty || 0
    if (qty <= 10) return ['technical_lead']
    return ['technical_lead', 'director']
  },
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
    default:
      return Number(details?.value ?? details?.amount ?? 0)
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

/**
 * Prefer DB approval_rules; fall back to hardcoded APPROVAL_RULES.
 * Safe when prisma is unavailable (returns hardcoded).
 */
export async function getApprovalRoles(type: ApprovalType, details: any): Promise<string[]> {
  try {
    const { default: prisma } = await import('@/lib/prisma')
    const rule = await prisma.approvalRule.findUnique({ where: { approvalType: type } })
    if (rule?.isActive) {
      const thresholds = rule.thresholds as ApprovalThreshold[]
      const value = extractApprovalValue(type, details)
      const fromDb = rolesFromThresholds(thresholds, value)
      if (fromDb) return fromDb
    }
  } catch {
    // table missing / prisma offline — use hardcoded
  }
  return getApprovalRolesSync(type, details)
}
