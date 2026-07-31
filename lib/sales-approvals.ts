// ─── Approval Workflow Engine ─────────────────────────────────────────────────

import type { ApprovalRequest, ApprovalLevel, ApprovalType } from './sales-flow-types'
import {
  APPROVAL_RULES,
  extractApprovalValue,
  getApprovalRoles,
  getApprovalRolesSync,
  rolesFromThresholds,
  type ApprovalThreshold,
} from '@/lib/sales-approval-rules'

export { APPROVAL_RULES, extractApprovalValue, getApprovalRoles, getApprovalRolesSync, rolesFromThresholds }
export type { ApprovalThreshold }

/**
 * Check if approval is required (sync — uses hardcoded rules for client UI).
 * Server paths that need DB-backed thresholds should call `requiresApprovalAsync`.
 */
export function requiresApproval(
  type: ApprovalType,
  details: any
): boolean {
  const requiredRoles = getApprovalRolesSync(type, details)
  return requiredRoles.length > 0
}

export async function requiresApprovalAsync(
  type: ApprovalType,
  details: any
): Promise<boolean> {
  const requiredRoles = await getApprovalRoles(type, details)
  return requiredRoles.length > 0
}

/**
 * Get required approval levels
 */
export function getApprovalLevels(
  type: ApprovalType,
  details: any,
  availableApprovers: { id: string; name: string; role: string }[]
): ApprovalLevel[] {
  const requiredRoles = getApprovalRolesSync(type, details)
  
  return requiredRoles.map((role, index) => {
    const approvers = availableApprovers.filter(a => a.role === role)
    
    return {
      level: index + 1,
      role: role as any,
      approverIds: approvers.map(a => a.id),
    }
  })
}

/**
 * Create approval request
 */
export function createApprovalRequest(
  type: ApprovalType,
  documentType: 'quote' | 'sales_order' | 'invoice',
  documentId: string,
  documentRef: string,
  requestedBy: string,
  requestedByName: string,
  details: any,
  approvers: { id: string; name: string; role: string }[]
): ApprovalRequest {
  const levels = getApprovalLevels(type, details, approvers)
  
  return {
    id: `apr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ref: `APR-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
    type,
    documentType,
    documentId,
    documentRef,
    requestedBy,
    requestedByName,
    requestedDate: new Date().toISOString().split('T')[0],
    details,
    approvers: levels,
    currentLevel: 1,
    status: 'pending',
  }
}

/**
 * Process approval decision
 */
export function processApproval(
  request: ApprovalRequest,
  approverId: string,
  approverName: string,
  decision: 'approved' | 'rejected',
  comments?: string
): ApprovalRequest {
  const currentLevel = request.approvers.find(a => a.level === request.currentLevel)
  
  if (!currentLevel) {
    throw new Error('Invalid approval level')
  }
  
  if (!currentLevel.approverIds.includes(approverId)) {
    throw new Error('User not authorized to approve at this level')
  }
  
  // Update current level
  const updatedApprovers = request.approvers.map(level => {
    if (level.level === request.currentLevel) {
      return {
        ...level,
        decision,
        decidedBy: approverId,
        decidedByName: approverName,
        comments,
        decidedDate: new Date().toISOString().split('T')[0],
      }
    }
    return level
  })
  
  // Determine next state
  if (decision === 'rejected') {
    return {
      ...request,
      approvers: updatedApprovers,
      status: 'rejected',
      rejectedBy: approverId,
      rejectedDate: new Date().toISOString().split('T')[0],
      rejectionReason: comments,
    }
  }
  
  // If approved, check if more levels
  const hasMoreLevels = request.currentLevel < request.approvers.length
  
  if (hasMoreLevels) {
    // Move to next level
    return {
      ...request,
      approvers: updatedApprovers,
      currentLevel: request.currentLevel + 1,
      status: 'pending',
    }
  }
  
  // Final approval
  return {
    ...request,
    approvers: updatedApprovers,
    status: 'approved',
    finalApprovedBy: approverId,
    finalApprovedDate: new Date().toISOString().split('T')[0],
  }
}

/**
 * Get pending approvals for user
 */
export function getPendingApprovals(
  allRequests: ApprovalRequest[],
  userId: string
): ApprovalRequest[] {
  return allRequests.filter(request => {
    if (request.status !== 'pending') return false
    
    const currentLevel = request.approvers.find(a => a.level === request.currentLevel)
    if (!currentLevel) return false
    
    return currentLevel.approverIds.includes(userId)
  })
}

/**
 * Check if user can approve
 */
export function canApprove(
  request: ApprovalRequest,
  userId: string
): boolean {
  if (request.status !== 'pending') return false
  
  const currentLevel = request.approvers.find(a => a.level === request.currentLevel)
  if (!currentLevel) return false
  
  return currentLevel.approverIds.includes(userId)
}

/**
 * Get approval status display
 */
export function getApprovalStatusDisplay(request: ApprovalRequest): {
  label: string
  color: string
  icon: string
} {
  switch (request.status) {
    case 'pending':
      return {
        label: `Pending (Level ${request.currentLevel}/${request.approvers.length})`,
        color: '#F59E0B',
        icon: '⏳'
}
    case 'approved':
      return {
        label: 'Approved',
        color: '#10B981',
        icon: '✓'
      }
    case 'rejected':
      return {
        label: 'Rejected',
        color: '#EF4444',
        icon: '✗'
      }
    case 'cancelled':
      return {
        label: 'Cancelled',
        color: '#6B7280',
        icon: '○'
      }
  }
}

/**
 * Calculate required approval based on discount
 */
export function calculateDiscountApproval(
  originalPrice: number,
  proposedPrice: number,
  originalTotal: number,
  newTotal: number
): {
  requiresApproval: boolean
  discountPercent: number
  discountAmount: number
  approvalType: ApprovalType
  requiredRoles: string[]
} {
  const discountAmount = originalTotal - newTotal
  const discountPercent = (discountAmount / originalTotal) * 100
  
  const requiredRoles = APPROVAL_RULES.discount({ discountPercent })
  
  return {
    requiresApproval: requiredRoles.length > 0,
    discountPercent,
    discountAmount,
    approvalType: 'discount',
    requiredRoles,
  }
}

/**
 * Validate sales order can be created
 */
export function validateSalesOrderCreation(
  lines: any[],
  products: any[],
  stockReservations: any[],
  controlRules: any
): {
  canCreate: boolean
  issues: string[]
  warnings: string[]
  requiresApproval: boolean
  approvalReasons: string[]
} {
  const issues: string[] = []
  const warnings: string[] = []
  const approvalReasons: string[] = []
  
  lines.forEach(line => {
    const product = products.find(p => p.id === line.productId)
    
    if (!product) {
      issues.push(`Product ${line.productName} not found`)
      return
    }
    
    // Check stock
    const reserved = stockReservations
      .filter(r => r.productId === line.productId && r.status === 'reserved')
      .reduce((sum, r) => sum + r.qty, 0)
    
    const available = product.stockQty - reserved
    
    if (available < line.qty) {
      if (controlRules.allowBackorders) {
        warnings.push(`${line.productName}: ${line.qty - available} units on backorder`)
        approvalReasons.push(`Backorder required for ${line.productName}`)
      } else if (!controlRules.allowSaleWithoutStock) {
        issues.push(`${line.productName}: Insufficient stock (need ${line.qty}, have ${available})`)
      }
    }
    
    // Check serial requirements
    if (product.requiresSerial && controlRules.requireSerialForTrackedItems) {
      if (!line.serialIds || line.serialIds.length < line.qty) {
        issues.push(`${line.productName}: Serial numbers required`)
      }
    }
  })
  
  return {
    canCreate: issues.length === 0,
    issues,
    warnings,
    requiresApproval: approvalReasons.length > 0,
    approvalReasons,
  }
}
