import 'server-only'

import { HR_MANAGER_ROLES, LEAVE_APPROVER_ROLES } from './access'
import type { ModuleId, PublicUser, UserRole } from './types'

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
  manageHR:                  [...HR_MANAGER_ROLES] as UserRole[],
  approveLeave:              [...LEAVE_APPROVER_ROLES] as UserRole[],
  approvePayroll:            ['director', 'finance_officer'] as UserRole[],
  // Read access to HR records (leave, HR documents, employee full profiles).
  // Includes technical_lead so leads can review their technicians' leave.
  viewHrRecords:             ['director', 'admin_officer', 'finance_officer', 'technical_lead'] as UserRole[],
  // Read access to full employee compensation/PII (salary, bank, national ID).
  viewEmployeeSensitive:     ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  manageInventoryApprovals:  ['director', 'inventory_officer', 'technical_lead', 'kilimall_officer'] as UserRole[],
  // Validate purchase receipts / GRNs — stock-affecting; keep tight.
  // technical_lead intentionally excluded (ops oversight ≠ stock receipt authority).
  validatePurchaseReceipt:   ['director', 'admin_officer', 'inventory_officer'] as UserRole[],
  editSerialNumber:          ['director', 'admin_officer', 'inventory_officer', 'technical_lead'] as UserRole[],
  printInventoryLabels:      ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'kilimall_officer', 'finance_officer'] as UserRole[],
  viewVendorInventoryLedger: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'] as UserRole[],
  viewPurchaseCost:          ['director', 'admin_officer', 'finance_officer', 'inventory_officer'] as UserRole[],
  // Draft customer invoice from a confirmed sale order.
  createCustomerInvoiceFromSO: ['director', 'finance_officer', 'admin_officer'] as UserRole[],
  // Post journals + customer invoice payment (Admin Officer threshold enforced in actions/API).
  postFinancial:             ['director', 'finance_officer', 'admin_officer'] as UserRole[],
  // Bank recon / bank accounts / statement lines — Finance + Director only.
  manageBankRecon:           ['director', 'finance_officer'] as UserRole[],
  // Customer credit ledger (cancel of a paid invoice writes a credit note here).
  manageCustomerCredit:      ['director', 'finance_officer', 'admin_officer'] as UserRole[],
  // Invoice/payment cash collection writes (narrower than recordSales).
  recordPayment:             ['director', 'finance_officer', 'admin_officer'] as UserRole[],
  // Sale order / delivery wholesale store writes.
  manageSaleOrders:          ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead'] as UserRole[],
  manageDeliveries:          ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'sales_rep'] as UserRole[],
  // Expense claims — submitters write own rows via merge; approve/reimburse is action-gated.
  manageExpenses:            ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'inventory_officer', 'technical_lead', 'technician', 'kilimall_officer'] as UserRole[],
  // Purchase order wholesale store writes — matches app/api/purchase-orders/[id]/route.ts's WRITE_ROLES.
  managePurchaseOrders:      ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'] as UserRole[],
  // Return-to-Vendor: stock-deducting and generates a vendor credit note — matches canManageProcurement.
  manageProcurement:         ['director', 'admin_officer', 'inventory_officer'] as UserRole[],
  // Decide discount/credit approvals (Finance + Director + Admin Officer).
  approveDiscount:           ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  // Request sales approvals (includes sales_rep so requests persist via store sync).
  requestSalesApproval:      ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'kilimall_officer', 'technical_lead'] as UserRole[],
  manageMasterData:          ['director', 'admin_officer', 'finance_officer'] as UserRole[],
  // Append commercial/finance audit rows (not director-only; reading remains director).
  appendAuditLog:            ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'inventory_officer', 'technical_lead', 'kilimall_officer'] as UserRole[],
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
  // Device reconfiguration work orders
  viewReconfiguration:       ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'sales_rep', 'technical_lead', 'technician', 'kilimall_officer'] as UserRole[],
  createReconfiguration:     ['director', 'admin_officer', 'sales_rep', 'technical_lead', 'kilimall_officer'] as UserRole[],
  editReconfigurationDraft:  ['director', 'admin_officer', 'sales_rep', 'technical_lead'] as UserRole[],
  reserveReconfigurationComponents: ['director', 'inventory_officer', 'technical_lead'] as UserRole[],
  approveReconfiguration:    ['director', 'admin_officer', 'finance_officer', 'technical_lead'] as UserRole[],
  performReconfigRemoval:    ['director', 'technical_lead', 'technician'] as UserRole[],
  performReconfigInstallation: ['director', 'technical_lead', 'technician'] as UserRole[],
  completeReconfigQa:        ['director', 'technical_lead'] as UserRole[],
  completeReconfiguration:   ['director', 'inventory_officer', 'technical_lead'] as UserRole[],
  overrideReconfigCompatibility: ['director', 'technical_lead'] as UserRole[],
  overrideReconfigStock:     ['director', 'inventory_officer'] as UserRole[],
  overrideMinimumMargin:     ['director', 'finance_officer'] as UserRole[],
  reverseReconfiguration:    ['director', 'finance_officer', 'technical_lead'] as UserRole[],
  viewReconfigComponentCosts: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'] as UserRole[],
  viewReconfigSellingPrices: ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead', 'kilimall_officer'] as UserRole[],
  viewReconfigAccounting:    ['director', 'finance_officer'] as UserRole[],
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
  deed_bankAccounts: 'manageBankRecon',
  deed_bankRecons: 'manageBankRecon',
  deed_bankStatementLines: 'manageBankRecon',
  deed_customerCredits: 'manageCustomerCredit',
  deed_salaryAdvances: 'manageHR',
  deed_riderWeeklyPays: 'manageHR',
  deed_systemSettings: 'manageMasterData',
  deed_companySettings: 'manageMasterData',
  deed_approvalRequests: 'requestSalesApproval',
  deed_workflowApprovals: 'approveDiscount',
  deed_auditLogs: 'appendAuditLog',
  // Commercial ledgers
  deed_invoices: 'recordRepairBilling',
  deed_payments: 'recordPayment',
  deed_posOrders: 'recordSales',
  deed_refundPayments: 'recordSales',
  deed_saleOrders: 'manageSaleOrders',
  deed_deliveries: 'manageDeliveries',
  deed_expenses: 'manageExpenses',
  // Purchase orders and Return-to-Vendor — previously missing here, which let
  // the generic wholesale store endpoint bypass the dedicated routes'
  // (and, for returns, the store action's) role gates entirely.
  deed_purchaseOrders: 'managePurchaseOrders',
  deed_purchaseReturns: 'manageProcurement',
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
  // Admin Officer needs bank account list to register customer payments.
  deed_bankAccounts: 'postFinancial',
  deed_bankRecons: 'manageBankRecon',
  deed_bankStatementLines: 'manageBankRecon',
  deed_customerCredits: 'manageCustomerCredit',
  deed_auditLogs: 'viewAuditLog',
}

type StoreReadUser = Pick<PublicUser, 'id' | 'role' | 'modules' | 'actsAsTechnician'>

type CollaborativeReadPolicy = {
  roles: readonly UserRole[]
  modules: readonly ModuleId[]
}

const ALL_OPERATIONAL_ROLES: readonly UserRole[] = [
  'director', 'admin_officer', 'finance_officer', 'inventory_officer',
  'kilimall_officer', 'sales_rep', 'technical_lead', 'technician',
]

// High-risk collaborative keys cannot be hidden wholesale because several
// roles legitimately share them. Require both an appropriate operational role
// and an explicit module grant; ownership filtering below then narrows rows for
// sales reps and technicians.
export const COLLABORATIVE_STORE_READ_POLICIES: Record<string, CollaborativeReadPolicy> = {
  deed_saleOrders: {
    roles: ['director', 'admin_officer', 'finance_officer', 'sales_rep'],
    modules: ['sales'],
  },
  deed_repairs_v2: {
    // Admin officers book intake + run the desk; finance needs billing follow-up.
    roles: ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'technician'],
    modules: ['repair'],
  },
  deed_contacts: {
    roles: ALL_OPERATIONAL_ROLES,
    modules: ['contacts', 'crm', 'sales', 'purchase', 'pos', 'repair', 'delivery', 'after_sales', 'outsource', 'deposits', 'holdovers', 'accounting'],
  },
  deed_products: {
    roles: ALL_OPERATIONAL_ROLES,
    modules: ['inventory', 'sales', 'purchase', 'pos', 'repair', 'refurbishment', 'ecommerce', 'kilimall', 'after_sales', 'holdovers', 'accounting'],
  },
}

export const canReadStoreKey = (
  user: StoreReadUser | null | undefined,
  key: string,
): boolean => {
  if (!user) return false
  const permission = SENSITIVE_STORE_KEY_READ_PERMISSIONS[key]
  if (permission && !hasPermission(user, permission)) return false

  const policy = COLLABORATIVE_STORE_READ_POLICIES[key]
  if (!policy) return true
  const role = normalizePermissionRole(user.role)
  const grants = new Set(user.modules ?? [])
  const hasModule = policy.modules.some(module => grants.has(module))
  if (!hasModule) return false
  if (role && policy.roles.includes(role)) return true
  // Chosen non-tech users (e.g. Kilimall) with actsAsTechnician + repair module
  if (key === 'deed_repairs_v2' && user.actsAsTechnician) return true
  return false
}

/**
 * Filter a set of store keys down to those the user is allowed to READ. Keys not
 * present in the read map are returned to everyone (multi-role collaborative
 * data); keys in the map require the mapped permission.
 */
export const filterReadableStoreKeys = (
  user: StoreReadUser | null | undefined,
  keys: string[],
): string[] => keys.filter(key => canReadStoreKey(user, key))

// ── Content-level filtering (Odoo ir.rule-style row ACL) ─────────────────────
// deed_invoices / deed_expenses can't be blocked outright like journal entries:
// many role workflows legitimately need a slice of them (repair billing, sales
// order → invoice status, purchases follow-up, own expense claims). Instead of
// all-or-nothing key gating, each role receives only the records it works with,
// and full financial visibility stays with the back-office roles.
export const CONTENT_FILTERED_STORE_KEYS = new Set([
  'deed_invoices',
  'deed_expenses',
  'deed_saleOrders',
  'deed_repairs_v2',
  'deed_opportunities',
])

type StoreRow = { [k: string]: unknown }

const invoiceSliceForRole = (role: UserRole | null, invoices: StoreRow[]): StoreRow[] => {
  switch (role) {
    case 'director':
    case 'finance_officer':
    case 'admin_officer':
      return invoices
    // Repair roles: only invoices linked to a repair job (billing + the
    // technical lead's repair-revenue dashboard).
    case 'technical_lead':
    case 'technician':
      return invoices.filter(inv => !!inv?.repairId)
    // Customer-facing sales/marketplace roles: customer invoices only — vendor
    // bills (payables) are back-office data.
    case 'sales_rep':
    case 'kilimall_officer':
      return invoices.filter(inv => inv?.type === 'customer_invoice')
    // Stock control: vendor bills only, for PO receiving/billing follow-up.
    case 'inventory_officer':
      return invoices.filter(inv => inv?.type === 'vendor_bill')
    default:
      return []
  }
}

/** True when the role receives the UNFILTERED value for a content-filtered key. */
export const hasFullStoreContentAccess = (
  user: StoreReadUser | null | undefined,
  key: string,
): boolean => {
  if (!CONTENT_FILTERED_STORE_KEYS.has(key)) return true
  if (COLLABORATIVE_STORE_READ_POLICIES[key] && !canReadStoreKey(user, key)) return false
  const role = normalizePermissionRole(user?.role)
  if (key === 'deed_invoices') return role === 'director' || role === 'finance_officer' || role === 'admin_officer'
  if (key === 'deed_expenses') return role === 'director' || role === 'finance_officer'
  if (key === 'deed_saleOrders') return role !== 'sales_rep'
  if (key === 'deed_repairs_v2') return role !== 'technician' && !user?.actsAsTechnician
  if (key === 'deed_opportunities') return role !== 'sales_rep'
  return true
}

/**
 * Reduce a store value to the slice the caller's role may read. Non-filtered
 * keys and non-array values pass through unchanged.
 */
export function filterStoreValueForRole(
  user: StoreReadUser | null | undefined,
  key: string,
  value: unknown,
): unknown {
  if (!CONTENT_FILTERED_STORE_KEYS.has(key) || !Array.isArray(value)) return value
  if (hasFullStoreContentAccess(user, key)) return value
  const role = normalizePermissionRole(user?.role)
  if (key === 'deed_invoices') return invoiceSliceForRole(role, value as StoreRow[])
  if (key === 'deed_expenses') {
    // Everyone keeps their own claims (self-service submissions/tracking).
    return (value as StoreRow[]).filter(e => !!e?.submittedByUserId && e.submittedByUserId === user?.id)
  }
  if (key === 'deed_saleOrders') {
    // ir.rule: sales reps see only orders they created or own as salesperson.
    return (value as StoreRow[]).filter(order => {
      if (!user?.id) return false
      return order.createdByUserId === user.id || order.salespersonId === user.id
    })
  }
  if (key === 'deed_repairs_v2') {
    return (value as StoreRow[]).filter(repair => !!user?.id && repair.assignedTechnicianId === user.id)
  }
  if (key === 'deed_opportunities') {
    if (role !== 'sales_rep') return value
    return (value as StoreRow[]).filter(opp => {
      if (!user?.id) return false
      return opp.ownerId === user.id || opp.assignedToId === user.id
    })
  }
  return value
}

/**
 * Merge a partial-view client's write into the full server ledger. Clients only
 * hold the slice their role can read, so replacing the stored array wholesale
 * would silently delete every record outside their view. Incoming rows are
 * upserted by id; existing rows they can't see are preserved.
 */
export function mergeFilteredStoreWrite(current: unknown, incoming: unknown): StoreRow[] {
  const currentArr: StoreRow[] = Array.isArray(current) ? current : []
  const incomingArr: StoreRow[] = Array.isArray(incoming) ? incoming : []
  const byId = new Map<unknown, StoreRow>()
  for (const row of currentArr) if (row && row.id != null) byId.set(row.id, row)
  for (const row of incomingArr) if (row && row.id != null) byId.set(row.id, row)
  return [...byId.values()]
}

export type RecordAccessModel = 'sale_order' | 'opportunity' | 'repair' | 'expense'

const saleOrderOwnedByUser = (record: StoreRow, userId: string) =>
  record.createdByUserId === userId || record.salespersonId === userId

const opportunityOwnedByUser = (record: StoreRow, userId: string) =>
  record.ownerId === userId || record.assignedToId === userId

/**
 * Row-level read/write guard for APIs (mirrors filterStoreValueForRole / ir.rule).
 */
export function canAccessRecord(
  role: string | null | undefined,
  model: RecordAccessModel,
  record: StoreRow,
  userId: string | null | undefined,
  options?: { actsAsTechnician?: boolean },
): boolean {
  const normalizedRole = normalizePermissionRole(role)
  if (!normalizedRole || !userId) return false

  switch (model) {
    case 'sale_order':
      if (['director', 'admin_officer', 'finance_officer', 'technical_lead'].includes(normalizedRole)) return true
      if (normalizedRole === 'sales_rep') return saleOrderOwnedByUser(record, userId)
      return false
    case 'opportunity':
      if (['director', 'admin_officer', 'finance_officer', 'kilimall_officer', 'technical_lead'].includes(normalizedRole)) return true
      if (normalizedRole === 'sales_rep') return opportunityOwnedByUser(record, userId)
      return false
    case 'repair':
      if (['director', 'admin_officer', 'finance_officer', 'technical_lead'].includes(normalizedRole)) return true
      if (normalizedRole === 'technician' || options?.actsAsTechnician) {
        return record.assignedTechnicianId === userId
      }
      return false
    case 'expense':
      if (['director', 'finance_officer', 'admin_officer'].includes(normalizedRole)) return true
      return record.submittedByUserId === userId
    default:
      return false
  }
}

// Store keys that carry an append-only audit trail and must NEVER be written by
// a client through either store-sync endpoint. The server maintains these
// itself (see appendStoreAudit / lib/inventory/audit.ts).
export const CLIENT_IMMUTABLE_STORE_KEYS = new Set<string>([
  'deed_audit_timeline_v1',
  // P0-SEC-002: legacy commercial audit blob is server-authored only.
  // Clients may still read it; writes via /api/store are dropped.
  'deed_auditLogs',
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
