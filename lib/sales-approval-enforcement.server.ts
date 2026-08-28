import 'server-only'
import type { ApprovalType } from '@/lib/sales-flow-types'
import { requiresApprovalAsync, getApprovalRoles } from '@/lib/sales-approval-rules.server'
import { loadAppState } from '@/lib/server-store'

const APPROVER_ROLES = new Set([
  'director',
  'finance_officer',
  'technical_lead',
  'admin_officer',
  'sales_rep',
])

function orderLines(body: any, existing?: any): any[] {
  const raw = Array.isArray(body.lines) ? body.lines : body.items
  if (Array.isArray(raw)) return raw.filter((l: any) => l.lineType !== 'section')
  return (existing?.items ?? []).filter((l: any) => l.lineType !== 'section')
}

export function maxLineDiscountPercent(lines: any[]): number {
  return lines.reduce((max, line) => Math.max(max, Number(line.discount ?? line.discountPercent ?? 0)), 0)
}

export async function creditOverrideDetails(
  clientId: string | undefined,
  orderTotal: number,
  body: any,
): Promise<{ creditRequested: number; creditAvailable: number } | null> {
  if (body.creditRequested != null || body.creditAvailable != null) {
    const creditRequested = Number(body.creditRequested ?? orderTotal)
    const creditAvailable = Number(body.creditAvailable ?? 0)
    if (creditRequested > creditAvailable) {
      return { creditRequested, creditAvailable }
    }
    return null
  }
  if (!clientId) return null
  try {
    const { default: prisma } = await import('@/lib/prisma')
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { creditLimit: true },
    })
    if (!client) return null
    const creditLimit = Number(client.creditLimit ?? 0)
    if (creditLimit <= 0) return null
    const open = await prisma.invoice.aggregate({
      where: {
        clientId,
        status: { in: ['approved', 'invoiced', 'pending_approval', 'dispatched', 'delivered'] },
      },
      _sum: { totalAmount: true, amountPaid: true },
    })
    const outstanding = Math.max(0, Number(open._sum.totalAmount ?? 0) - Number(open._sum.amountPaid ?? 0))
    const creditAvailable = Math.max(0, creditLimit - outstanding)
    if (orderTotal > creditAvailable || body.creditLimitExceeded === true) {
      return { creditRequested: orderTotal, creditAvailable }
    }
    return null
  } catch {
    return null
  }
}

export async function collectApprovalTriggers(
  body: any,
  existing?: any,
): Promise<Array<{ type: ApprovalType; details: Record<string, unknown> }>> {
  const lines = orderLines(body, existing)
  const total = Number(body.totalAmount ?? body.total ?? existing?.totalAmount ?? 0)
  const triggers: Array<{ type: ApprovalType; details: Record<string, unknown> }> = []

  const discountPercent = maxLineDiscountPercent(lines)
  if (discountPercent > 0) {
    triggers.push({
      type: 'discount',
      details: {
        discountPercent,
        discountAmount: Number(body.discountAmount ?? existing?.discountAmount ?? 0),
      },
    })
  }

  const clientId = body.clientId ?? body.customerId ?? existing?.clientId
  const credit = await creditOverrideDetails(clientId, total, body)
  if (credit) {
    triggers.push({ type: 'credit_override', details: credit })
  }

  if (
    body.belowPricelist === true
    || body.specialPricing === true
    || body.belowCost === true
    || body.belowFloor === true
    || body.belowMinimumMargin === true
  ) {
    triggers.push({
      type: 'special_pricing',
      details: {
        value: total,
        belowCost: body.belowCost === true || body.belowFloor === true,
        belowMargin: body.belowMinimumMargin === true,
        belowPricelist: body.belowPricelist === true,
        minMarginPercent: body.minMarginPercent,
        worstMargin: body.worstMargin,
        products: body.pricingExceptionProducts,
      },
    })
  }

  // Server-side floor/margin scan when line payloads (or existing items) are present.
  if (lines.length > 0) {
    try {
      const { computeSaleOrderApprovalTriggers } = await import('@/lib/sales/margin-approval')
      const productIds = [...new Set(lines.map((l: any) => l.productId).filter(Boolean))]
      if (productIds.length > 0) {
        const { default: prisma } = await import('@/lib/prisma')
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            costPrice: true,
            trackStock: true,
            sellingPrice: true,
            productType: true,
            specs: true,
            category: { select: { name: true } },
          },
        })
        const appState = await loadAppState().catch(() => null as any)
        const settings = (appState as any)?.deed_systemSettings ?? (appState as any)?.systemSettings ?? {}
        const marginTriggers = computeSaleOrderApprovalTriggers({
          lines,
          products: products.map(p => {
            const specs = (p.specs && typeof p.specs === 'object' ? p.specs : {}) as Record<string, unknown>
            return {
              id: p.id,
              name: p.name,
              costPrice: Number(p.costPrice) || 0,
              trackStock: p.trackStock,
              salePrice: Number(p.sellingPrice) || 0,
              sellingPrice: Number(p.sellingPrice) || 0,
              category: p.category?.name || null,
              productType: p.productType || null,
              pricingCategoryId:
                typeof specs.pricingCategoryId === 'string' ? specs.pricingCategoryId : null,
            }
          }),
          headerDiscountAmount: Number(body.discountAmount ?? existing?.discountAmount ?? 0),
          orderTotal: total,
          minMarginPercent: Number(body.minMarginPercent ?? settings.salesMinMarginPercent ?? 10),
          pricingMarginPolicy: settings.pricingMarginPolicy,
        })
        for (const t of marginTriggers) {
          if (t.type !== 'special_pricing' && t.type !== 'discount') continue
          if (triggers.some(x => x.type === t.type)) continue
          triggers.push({ type: t.type, details: t.details })
        }
      }
    } catch {
      // Best-effort — client-side sync still creates approval requests.
    }
  }

  const backorderQty = Number(body.backorderQty ?? 0)
  if (backorderQty > 0) {
    triggers.push({ type: 'backorder', details: { backorderQty } })
  }

  return triggers
}

async function resolveApprovedRoles(body: any, sessionUserId: string): Promise<string[]> {
  const roles = new Set<string>()
  if (Array.isArray(body.approvedByRoles)) {
    body.approvedByRoles.forEach((r: unknown) => {
      if (typeof r === 'string' && r.trim()) roles.add(r.trim())
    })
  }
  const approvedBy = body.approvedBy
  if (typeof approvedBy === 'string' && approvedBy.trim()) {
    if (APPROVER_ROLES.has(approvedBy)) {
      roles.add(approvedBy)
    } else {
      try {
        const { default: prisma } = await import('@/lib/prisma')
        const user = await prisma.user.findUnique({
          where: { id: approvedBy },
          select: { role: true },
        })
        if (user?.role) roles.add(String(user.role))
      } catch {
        // ignore lookup failures
      }
    }
  }
  if (body.approvedBy === sessionUserId || body.approvedById === sessionUserId) {
    try {
      const { default: prisma } = await import('@/lib/prisma')
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { role: true },
      })
      if (user?.role) roles.add(String(user.role))
    } catch {
      // ignore
    }
  }
  return [...roles]
}

function rolesSatisfied(requiredRoles: string[], approvedRoles: string[]): boolean {
  if (requiredRoles.length === 0) return true
  const approved = new Set(approvedRoles)
  return requiredRoles.every(r => approved.has(r))
}

function triggerRolesSatisfied(
  type: ApprovalType,
  requiredRoles: string[],
  approvedRoles: string[],
): boolean {
  if (requiredRoles.length === 0) return true
  const approved = new Set(approvedRoles)
  if (type === 'discount' || type === 'special_pricing') {
    return requiredRoles.some(r => approved.has(r))
  }
  return rolesSatisfied(requiredRoles, approvedRoles)
}

async function hasApprovedRequest(orderId: string, type: ApprovalType): Promise<boolean> {
  try {
    const state = await loadAppState(['deed_approvalRequests'])
    const rows = state.deed_approvalRequests
    if (!Array.isArray(rows)) return false
    return rows.some(
      (r: any) => r.documentId === orderId && r.type === type && r.status === 'approved',
    )
  } catch {
    return false
  }
}

export type ApprovalEnforcementResult =
  | { ok: true }
  | { ok: false; status: number; error: string; requiredRoles: string[] }

/**
 * Enforce DB-backed approval thresholds on sale-order writes.
 * Draft quotation saves are allowed without approver; confirmation and
 * explicit approval claims require matching roles.
 */
export async function enforceSaleOrderApprovals(opts: {
  body: any
  existing?: any
  sessionUserId: string
  sessionRole: string
  fromStatus: string
  toStatus: string
}): Promise<ApprovalEnforcementResult> {
  const { body, existing, sessionUserId, fromStatus, toStatus } = opts
  const isConfirming = toStatus === 'sale' && fromStatus !== 'sale'
  const orderId = existing?.id ?? body.id

  if (isConfirming) {
    // Do not fail-close on a leftover `existing.approvalStatus === 'pending'`
    // from special_pricing while that ladder is on hold. Client leftover
    // checks still block discount / credit; trigger scan below still enforces.
    const pendingFlag =
      body.approvalStatus === 'pending' ||
      (typeof body.approvalRequiredReason === 'string' && body.approvalRequiredReason.length > 0 &&
        body.approvalStatus !== 'approved' && body.approvalStatus !== 'not_required')
    if (pendingFlag) {
      return {
        ok: false,
        status: 403,
        error: 'Sales order has pending approval requirements before confirmation',
        requiredRoles: [],
      }
    }
  }

  const triggers = await collectApprovalTriggers(body, existing)
  const requiredTypes: ApprovalType[] = []
  const requiredRoles: string[] = []
  const triggerRoleSets: Array<{ type: ApprovalType; roles: string[] }> = []

  for (const trigger of triggers) {
    const needs = await requiresApprovalAsync(trigger.type, trigger.details)
    if (!needs) continue
    requiredTypes.push(trigger.type)
    const roles = await getApprovalRoles(trigger.type, trigger.details)
    triggerRoleSets.push({ type: trigger.type, roles })
    roles.forEach(r => {
      if (!requiredRoles.includes(r)) requiredRoles.push(r)
    })
  }

  if (requiredRoles.length === 0) return { ok: true }

  const draftSave = !isConfirming && ['quotation', 'quotation_sent'].includes(toStatus)
  if (draftSave && !body.approvedBy && !body.approvedByRoles && body.approvalStatus !== 'approved') {
    return { ok: true }
  }

  if (orderId) {
    const allApproved = await Promise.all(
      requiredTypes.map(t => hasApprovedRequest(orderId, t)),
    )
    if (allApproved.every(Boolean)) return { ok: true }
  }

  const approvedRoles = await resolveApprovedRoles(body, sessionUserId)
  if (opts.sessionRole && APPROVER_ROLES.has(opts.sessionRole)) {
    approvedRoles.push(opts.sessionRole)
  }

  const uniqApproved = [...new Set(approvedRoles)]
  const unmet = triggerRoleSets.filter(t => !triggerRolesSatisfied(t.type, t.roles, uniqApproved))
  if (unmet.length > 0) {
    return {
      ok: false,
      status: 403,
      error: 'Approval required for discount, credit override, or pricing exception',
      requiredRoles: [...new Set(unmet.flatMap(t => t.roles))],
    }
  }

  return { ok: true }
}
