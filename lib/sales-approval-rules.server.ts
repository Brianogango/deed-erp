import 'server-only'
import type { ApprovalType } from '@/lib/sales-flow-types'
import {
  extractApprovalValue,
  getApprovalRolesSync,
  rolesFromThresholds,
  type ApprovalThreshold,
} from '@/lib/sales-approval-rules'

/**
 * Prefer DB approval_rules; fall back to hardcoded APPROVAL_RULES.
 * Server-only — never import from client bundles (store / AppShell).
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

export async function requiresApprovalAsync(type: ApprovalType, details: any): Promise<boolean> {
  const requiredRoles = await getApprovalRoles(type, details)
  return requiredRoles.length > 0
}
