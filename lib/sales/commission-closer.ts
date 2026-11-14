/**
 * The document creator and the person who closed the sale are different
 * fields. Commission posts to SaleOrder.salespersonId when the customer
 * invoice is posted — never to createdBy.
 *
 * POS has no sale order. The till cashier stays createdBy; the chosen closer
 * is stored on the ticket and passed as salespersonId when the POS invoice is
 * created already posted. Commission then writes sales_commissions on Charge.
 */

import { extractRepairRefFromText } from '@/lib/repair/sale-order-link'

export function isPosInvoiceWrite(body?: Record<string, unknown> | null): boolean {
  return body?.isPosInvoice === true
}

/** Workshop repair billing never earns sales commission, even if a Sale Order was created to invoice the job. */
export function salesCommissionAppliesToInvoice(invoice: {
  repairId?: string | null
}): boolean {
  return !invoice.repairId
}

export function isRepairLinkedSaleOrder(
  order: { notes?: string | null },
  invoices: readonly { repairId?: string | null }[] = [],
): boolean {
  if (invoices.some(inv => Boolean(inv.repairId))) return true
  const notes = String(order.notes || '').trim()
  if (/^Repair (order|quote)\b/i.test(notes)) return true
  return Boolean(extractRepairRefFromText(notes))
}

const COMMISSION_CLOSER_ROLES = [
  'sales_rep',
  'director',
  'admin_officer',
  'kilimall_officer',
] as const
type CommissionCloserUser = {
  id: string
  name: string
  role?: string | null
  active?: boolean | null
  employeeId?: string | null
}

export type CommissionCloserOption = {
  id: string
  name: string
  role: string
  hasEmployee: boolean
}

export function isCommissionCloserRole(role?: string | null): boolean {
  return (COMMISSION_CLOSER_ROLES as readonly string[]).includes(String(role || ''))
}

function toCommissionCloserOption(user: CommissionCloserUser): CommissionCloserOption {
  return {
    id: user.id,
    name: String(user.name || '').trim() || 'Unnamed',
    role: String(user.role || ''),
    hasEmployee: Boolean(user.employeeId),
  }
}

export function commissionCloserOptions(users: readonly CommissionCloserUser[]): CommissionCloserOption[] {
  return users
    .filter(user => user.active !== false && isCommissionCloserRole(user.role))
    .map(toCommissionCloserOption)
    .sort((a, b) => a.name.localeCompare(b.name))
}

