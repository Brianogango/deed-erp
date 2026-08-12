// ─── Approval Workflow Engine ─────────────────────────────────────────────────

import type { ApprovalRequest, ApprovalLevel, ApprovalType } from './sales-flow-types'
import {
  APPROVAL_RULES,
  approvalRolesAreAnyOf,
  extractApprovalValue,
  getApprovalRolesSync,
  rolesFromThresholds,
  type ApprovalThreshold,
} from '@/lib/sales-approval-rules'

export {
  APPROVAL_RULES,
  approvalRolesAreAnyOf,
  extractApprovalValue,
  getApprovalRolesSync,
  rolesFromThresholds,
}
export type { ApprovalThreshold }

/**
 * Check if approval is required (sync — uses hardcoded rules for client UI).
 * Server paths that need DB-backed thresholds should import
 * `requiresApprovalAsync` from `@/lib/sales-approval-rules.server`.
 */
export function requiresApproval(
  type: ApprovalType,
  details: any
): boolean {
  const requiredRoles = getApprovalRolesSync(type, details)
  return requiredRoles.length > 0
}

function levelRoles(level: ApprovalLevel): string[] {
  if (Array.isArray(level.roles) && level.roles.length > 0) return level.roles
  return level.role ? [level.role] : []
}

/**
 * Get required approval levels.
 * Price types collapse into a single any-of level (Director OR Finance).
 * Other types keep a sequential role chain.
 */
export function getApprovalLevels(
  type: ApprovalType,
  details: any,
  availableApprovers: { id: string; name: string; role: string }[]
): ApprovalLevel[] {
  const requiredRoles = getApprovalRolesSync(type, details)
  if (requiredRoles.length === 0) return []

  if (approvalRolesAreAnyOf(type)) {
    const approvers = availableApprovers.filter(a => requiredRoles.includes(a.role))
    return [{
      level: 1,
      role: requiredRoles[0] as ApprovalLevel['role'],
      roles: requiredRoles as ApprovalLevel['roles'],
      approverIds: approvers.map(a => a.id),
    }]
  }

  return requiredRoles.map((role, index) => {
    const approvers = availableApprovers.filter(a => a.role === role)
    return {
      level: index + 1,
      role: role as ApprovalLevel['role'],
      roles: [role as ApprovalLevel['role']],
      approverIds: approvers.map(a => a.id),
    }
  })
}

/**
 * Create approval request
 */
export function createApprovalRequest(
  type: ApprovalType,
  documentType: 'quote' | 'sales_order' | 'invoice' | 'purchase_order',
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
  comments?: string,
  approverRole?: string,
): ApprovalRequest {
  const currentLevel = request.approvers.find(a => a.level === request.currentLevel)
  
  if (!currentLevel) {
    throw new Error('Invalid approval level')
  }

  // Prefer the snapshot list, but also allow anyone currently holding a
  // required role for this level (covers stale approverIds / any-of price roles).
  const authorized =
    currentLevel.approverIds.includes(approverId)
    || (Boolean(approverRole) && levelRoles(currentLevel).includes(String(approverRole)))
  
  if (!authorized) {
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
  userId: string,
  userRole?: string,
): ApprovalRequest[] {
  return allRequests.filter(request => canApprove(request, userId, userRole))
}

/**
 * Check if user can approve
 */
export function canApprove(
  request: ApprovalRequest,
  userId: string,
  userRole?: string,
): boolean {
  if (request.status !== 'pending') return false
  
  const currentLevel = request.approvers.find(a => a.level === request.currentLevel)
  if (!currentLevel) return false

  if (currentLevel.approverIds.includes(userId)) return true
  if (userRole && levelRoles(currentLevel).includes(userRole)) return true
  return false
}

/** User ids who should be notified for the current approval level. */
export function approvalRecipientIds(
  request: ApprovalRequest,
  users: Array<{ id: string; role: string }>,
): string[] {
  const currentLevel = request.approvers.find(a => a.level === request.currentLevel)
  if (!currentLevel) return []
  const fromSnapshot = currentLevel.approverIds ?? []
  const allowed = new Set(levelRoles(currentLevel))
  const fromRole = users.filter(u => allowed.has(u.role)).map(u => u.id)
  return [...new Set([...fromSnapshot, ...fromRole].filter(Boolean))]
}

export function approvalDocumentPath(request: ApprovalRequest): string {
  if (request.documentType === 'purchase_order') return `/purchases?id=${request.documentId}`
  return `/sales?id=${request.documentId}`
}

export type SalesOrderStockCheckOptions = {
  /**
   * Ignore reservations already held by this document.
   * Without this, a quote-converted SO that reserved its own stock always
   * looks short (stockQty − own reservation) and falsely triggers backorder.
   */
  excludeReferenceId?: string
  /**
   * Optional free sellable qty by product id (e.g. available/in_stock serials).
   * When omitted, falls back to product.stockQty (on-hand).
   */
  freeQtyByProductId?: Record<string, number>
}

/** Reservations that consume free stock for other documents. */
export function reservedQtyElsewhere(
  stockReservations: Array<{ productId?: string; status?: string; qty?: number; referenceId?: string }>,
  productId: string,
  excludeReferenceId?: string,
): number {
  return (stockReservations ?? [])
    .filter(r =>
      r.productId === productId &&
      r.status === 'reserved' &&
      (!excludeReferenceId || r.referenceId !== excludeReferenceId),
    )
    .reduce((sum, r) => sum + (Number(r.qty) || 0), 0)
}

export type ConfirmBackorderLine = {
  productId: string
  productName: string
  qtyOrdered: number
  qtyAvailable: number
  qtyBackordered: number
}

/** Lines that need backorder approval at confirm time. */
export function computeConfirmBackorderLines(
  lines: Array<{ productId?: string; productName?: string; qty?: number; lineType?: string; unit?: string }>,
  products: Array<{ id: string; name?: string; stockQty?: number; unit?: string }>,
  stockReservations: Array<{ productId?: string; status?: string; qty?: number; referenceId?: string }>,
  options: SalesOrderStockCheckOptions = {},
): ConfirmBackorderLine[] {
  return (lines ?? []).flatMap(line => {
    if (!line?.productId || line.lineType === 'section') return []
    const product = products.find(p => p.id === line.productId)
    if (!product || product.unit === 'service') return []
    const onHand = options.freeQtyByProductId?.[product.id] ?? (Number(product.stockQty) || 0)
    const reserved = reservedQtyElsewhere(stockReservations, product.id, options.excludeReferenceId)
    const available = Math.max(0, onHand - reserved)
    const qtyOrdered = Number(line.qty) || 0
    if (qtyOrdered <= 0 || available >= qtyOrdered) return []
    return [{
      productId: product.id,
      productName: line.productName || product.name || 'Item',
      qtyOrdered,
      qtyAvailable: available,
      qtyBackordered: qtyOrdered - available,
    }]
  })
}

/**
 * Validate sales order can be created / confirmed (stock + serial gates).
 */
export function validateSalesOrderCreation(
  lines: any[],
  products: any[],
  stockReservations: any[],
  controlRules: any,
  options: SalesOrderStockCheckOptions = {},
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
    if (line?.lineType === 'section') return
    const product = products.find(p => p.id === line.productId)
    
    if (!product) {
      issues.push(`Product ${line.productName} not found`)
      return
    }

    if (product.unit === 'service') return
    
    // Check free stock minus OTHER documents' reservations (not this order's).
    const onHand = options.freeQtyByProductId?.[product.id] ?? (Number(product.stockQty) || 0)
    const reserved = reservedQtyElsewhere(stockReservations, product.id, options.excludeReferenceId)
    const available = onHand - reserved
    
    if (available < line.qty) {
      if (controlRules.allowBackorders) {
        warnings.push(`${line.productName}: ${line.qty - available} units on backorder`)
        approvalReasons.push(`Backorder required for ${line.productName}`)
      } else if (!controlRules.allowSaleWithoutStock) {
        issues.push(`${line.productName}: Insufficient stock (need ${line.qty}, have ${Math.max(0, available)})`)
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
