/**
 * The document creator and the person who closed the sale are different
 * fields. Commission posts to SaleOrder.salespersonId when the customer
 * invoice is posted — never to createdBy.
 */

export const COMMISSION_CLOSER_ROLES = [
  'sales_rep',
  'director',
  'admin_officer',
  'kilimall_officer',
] as const

export type CommissionCloserRole = (typeof COMMISSION_CLOSER_ROLES)[number]

export type CommissionCloserUser = {
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

export function toCommissionCloserOption(user: CommissionCloserUser): CommissionCloserOption {
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

export function commissionCloserSelectOptions(closers: readonly CommissionCloserOption[]) {
  return closers.map(closer => ({
    value: closer.id,
    label: closer.hasEmployee ? closer.name : `${closer.name} (no HR employee — commission will not post)`,
  }))
}

export function commissionCloserHint(opts: {
  closer?: CommissionCloserOption | null
  createdByName?: string | null
}): string {
  const created = String(opts.createdByName || '').trim()
  if (opts.closer && !opts.closer.hasEmployee) {
    return `${opts.closer.name} has no Employee record in HR. Posting the invoice will not create commission until that login is linked.`
  }
  if (created) {
    return `Creator stays ${created}. Commission goes to the person chosen here when the customer invoice is posted — not when the quote is saved.`
  }
  return 'Commission goes to the person chosen here when the customer invoice is posted — not when the quote is saved.'
}
