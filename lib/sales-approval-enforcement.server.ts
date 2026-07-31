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
  const raw = body.items ?? body.lines
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
    return {
      creditRequested: Number(body.creditRequested ?? orderTotal),
      creditAvailable: Number(body.creditAvailable ?? 0),
    }
  }
  if (!clientId || body.creditLimitExceeded !== true) return null
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
    return { creditRequested: orderTotal, creditAvailable }
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

  if (body.belowPricelist === true || body.specialPricing === true) {
    triggers.push({
      type: 'special_pricing',
      details: { value: total },
    })
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
    const pendingFlag =
      body.approvalStatus === 'pending' ||
      existing?.approvalStatus === 'pending' ||
      (typeof body.approvalRequiredReason === 'string' && body.approvalRequiredReason.length > 0 &&
        body.approvalStatus !== 'approved')
    if (pendingFlag && body.approvalStatus !== 'approved') {
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

  for (const trigger of triggers) {
    const needs = await requiresApprovalAsync(trigger.type, trigger.details)
    if (!needs) continue
    requiredTypes.push(trigger.type)
    const roles = await getApprovalRoles(trigger.type, trigger.details)
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

  if (!rolesSatisfied(requiredRoles, [...new Set(approvedRoles)])) {
    return {
      ok: false,
      status: 403,
      error: 'Approval required for discount, credit override, or pricing exception',
      requiredRoles,
    }
  }

  return { ok: true }
}
