import 'server-only'

import type { PublicUser, UserRole } from './types'

export const normalizePermissionRole = (role: string | null | undefined): UserRole | null => {
  if (!role) return null
  const aliases: Record<string, UserRole> = {
    super_admin: 'director',
    admin: 'director',
    director: 'director',
    admin_officer: 'admin_officer',
    finance: 'finance_officer',
    finance_officer: 'finance_officer',
    inventory: 'inventory_officer',
    inventory_officer: 'inventory_officer',
    kilimall: 'kilimall_officer',
    kilimall_officer: 'kilimall_officer',
    sales: 'sales_rep',
    sales_rep: 'sales_rep',
    lead_tech: 'technical_lead',
    technical_lead: 'technical_lead',
    repair_tech: 'technician',
    technician: 'technician',
  }
  return aliases[role] ?? (role as UserRole)
}

export const isSuperAdminRole = (role: string | null | undefined) => normalizePermissionRole(role) === 'director'

// Shared predicate so every "is this role in this allow-list" check (requireRole,
// the server-store-crud factory's requireSession, etc.) normalizes and compares
// roles the same way instead of each reimplementing it.
export const isRoleAllowed = (role: string | null | undefined, allowedRoles: string[]) => {
  const normalizedRole = normalizePermissionRole(role)
  const normalizedAllowedRoles = allowedRoles.map(allowedRole => normalizePermissionRole(allowedRole)).filter(Boolean)
  return !!normalizedRole && normalizedAllowedRoles.includes(normalizedRole)
}

const roleMatrix = {
  manageUsers:               ['director'] as UserRole[],
  viewUsers:                 ['director', 'admin_officer'] as UserRole[],
  manageHR:                  ['director', 'admin_officer'] as UserRole[],
  approveLeave:              ['director', 'admin_officer'] as UserRole[],
  approvePayroll:            ['director', 'finance_officer'] as UserRole[],
  // Read access to HR records (leave, HR documents, employee full profiles).
  // Includes technical_lead so leads can review their technicians' leave.
  viewHrRecords:             ['director', 'admin_officer', 'finance_officer', 'technical_lead'] as UserRole[],
  // Read access to full employee compensation/PII (salary, bank, national ID).
  viewEmployeeSensitive:     ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  manageInventoryApprovals:  ['director', 'inventory_officer', 'technical_lead', 'kilimall_officer'] as UserRole[],
  postFinancial:             ['director', 'finance_officer'] as UserRole[],
  approvePurchaseOrder:      ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  approveDiscount:           ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  manageMasterData:          ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  viewAuditLog:              ['director'] as UserRole[],
  // Commercial document creation: invoices, standalone payments, POS orders and
  // after-sales refunds. Every role that legitimately sells or refunds is
  // included; purely operational roles (technician, inventory_officer,
  // technical_lead) are excluded so they cannot fabricate financial records
  // through the wholesale store-sync endpoint.
  recordSales:               ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'kilimall_officer'] as UserRole[],
  // Repair billing: technical leads own the repair-quote lifecycle (quote →
  // client approval → linked invoice), so they may write the invoice ledger.
  // POS orders, standalone payments and refunds remain sales/finance-only.
  recordRepairBilling:       ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'kilimall_officer', 'technical_lead'] as UserRole[],
  // Layby / deposit ledger — matches the roles granted the deposits module.
  manageDeposits:            ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  // Payroll runs and payslips — matches the payroll API role set.
  managePayroll:             ['director', 'admin_officer', 'finance_officer'] as UserRole[],
} as const

export type PermissionAction = keyof typeof roleMatrix

// Generic app-state keys (synced wholesale via POST /api/store and PUT /api/store/[key])
// that carry financial, HR, settings, approval, or audit data and therefore need a
// permission check beyond "is authenticated" before they can be written. Keys not
// listed here keep the existing behaviour: any authenticated user may write them,
// since most domains (quotes, repairs, inventory, CRM, ...) are legitimately
// multi-role collaborative data.
export const SENSITIVE_STORE_KEY_PERMISSIONS: Record<string, PermissionAction> = {
  deed_journalEntries: 'postFinancial',
  deed_accounts: 'postFinancial',
  deed_bankAccounts: 'postFinancial',
  deed_bankRecons: 'postFinancial',
  deed_bankStatementLines: 'postFinancial',
  deed_customerCredits: 'postFinancial',
  deed_salaryAdvances: 'manageHR',
  deed_riderWeeklyPays: 'manageHR',
  deed_systemSettings: 'manageMasterData',
  deed_companySettings: 'manageMasterData',
  deed_approvalRequests: 'approveDiscount',
  deed_workflowApprovals: 'approveDiscount',
  deed_auditLogs: 'viewAuditLog',
  // Commercial ledgers — writable only by roles that sell/refund. This closes
  // the hole where any authenticated user (e.g. a technician) could overwrite
  // the entire invoice/payment/POS ledger via the wholesale store-sync endpoint.
  deed_invoices: 'recordRepairBilling',
  deed_payments: 'recordSales',
  deed_posOrders: 'recordSales',
  deed_refundPayments: 'recordSales',
  // Layby deposits and payroll — restricted to their respective back-office roles.
  deed_deposits: 'manageDeposits',
  deed_payrollRuns: 'managePayroll',
  deed_payslips: 'managePayroll',
  // HR leave ledger — self-service leave is created through the dedicated
  // /api/leave-requests endpoint (which forces ownership + pending status), so
  // wholesale writes here are restricted to HR approvers.
  deed_leaveRequests: 'approveLeave',
  deed_leaveBalances: 'manageHR',
}

// Read gating for the wholesale store endpoints (GET /api/store, GET
// /api/store/[key], and the SSE stream). Keys listed here are only included in
// the response for users holding the permission; everyone else simply does not
// receive them. Sensitive HR/payroll/financial data must never be broadcast to
// every authenticated session. Self-service data (a user's own leave, payslip)
// is served instead by dedicated, ownership-scoped endpoints.
export const SENSITIVE_STORE_KEY_READ_PERMISSIONS: Record<string, PermissionAction> = {
  deed_payrollRuns: 'managePayroll',
  deed_payslips: 'managePayroll',
  deed_salaryAdvances: 'manageHR',
  deed_riderWeeklyPays: 'manageHR',
  deed_leaveRequests: 'viewHrRecords',
  deed_leaveBalances: 'viewHrRecords',
  deed_hrDocuments: 'viewHrRecords',
  deed_journalEntries: 'postFinancial',
  deed_accounts: 'postFinancial',
  deed_bankAccounts: 'postFinancial',
  deed_bankRecons: 'postFinancial',
  deed_bankStatementLines: 'postFinancial',
  deed_customerCredits: 'postFinancial',
  deed_auditLogs: 'viewAuditLog',
}

/**
 * Filter a set of store keys down to those the user is allowed to READ. Keys not
 * present in the read map are returned to everyone (multi-role collaborative
 * data); keys in the map require the mapped permission.
 */
export const filterReadableStoreKeys = (
  user: Pick<PublicUser, 'role'> | null | undefined,
  keys: string[],
): string[] =>
  keys.filter(key => {
    const action = SENSITIVE_STORE_KEY_READ_PERMISSIONS[key]
    return !action || hasPermission(user, action)
  })

// Store keys that carry an append-only audit trail and must NEVER be written by
// a client through either store-sync endpoint. The server maintains these
// itself (see appendStoreAudit in app/api/store/route.ts).
export const CLIENT_IMMUTABLE_STORE_KEYS = new Set<string>([
  'deed_audit_timeline_v1',
])

export const hasPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!user) return false
  const normalizedRole = normalizePermissionRole(user.role)
  return !!normalizedRole && roleMatrix[action].includes(normalizedRole)
}

export const assertPermission = (user: Pick<PublicUser, 'role'> | null | undefined, action: PermissionAction) => {
  if (!hasPermission(user, action)) {
    const error = new Error('Forbidden')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }
}
