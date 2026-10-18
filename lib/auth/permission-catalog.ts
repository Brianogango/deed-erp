/**
 * Every permission a role can hold, in plain words, grouped the way the Settings
 * role editor shows them. Pure and shared: the editor, the screens and the
 * server all read the same list.
 *
 * Two kinds of permission:
 *  - Named actions (the ones in ROLE_MATRIX) — the server refuses them.
 *  - Parts of a module (a tab such as Finance → Cheques) — `enforcement` says
 *    whether the server also refuses, or only the screen is hidden because the
 *    data feed behind it is shared with the rest of the module.
 */
import type { ModuleId, UserRole } from './types'
import { ROLE_MATRIX, type PermissionAction } from './role-matrix'

export type Enforcement = 'server' | 'screen'

export interface PermissionDef {
  key: string
  /** A module id, or 'admin' for Settings and administration. */
  group: string
  label: string
  hint?: string
  /** Shows money, cost, pay or personal data — marked in the editor. */
  sensitive?: boolean
  enforcement: Enforcement
  /**
   * Who has it today without a custom role. A list of built-in roles, or
   * 'module' = anyone who can open the group's module.
   */
  builtIn: readonly UserRole[] | 'module'
}

export interface PermissionGroup {
  id: string
  label: string
  /** The module a person must be able to open to use this group. */
  module?: ModuleId
  items: PermissionDef[]
}

const action = (key: PermissionAction, group: string, label: string, extra: Partial<PermissionDef> = {}): PermissionDef => ({
  key,
  group,
  label,
  enforcement: 'server',
  builtIn: ROLE_MATRIX[key] as readonly UserRole[],
  ...extra,
})

const part = (key: string, group: string, label: string, extra: Partial<PermissionDef> = {}): PermissionDef => ({
  key,
  group,
  label,
  enforcement: 'screen',
  builtIn: 'module',
  ...extra,
})

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'accounting',
    label: 'Finance & Accounting',
    module: 'accounting',
    items: [
      part('accounting.dashboard', 'accounting', 'Action centre'),
      part('accounting.invoices', 'accounting', 'Customer invoices'),
      part('accounting.credits', 'accounting', 'Customer credits'),
      part('accounting.credit_applications', 'accounting', 'Credit account applications'),
      part('accounting.refunds', 'accounting', 'Refunds'),
      part('accounting.commissions', 'accounting', 'Sales commissions'),
      part('accounting.bills', 'accounting', 'Vendor bills'),
      part('accounting.agent_commissions', 'accounting', 'Agent commissions'),
      part('accounting.cashbook', 'accounting', 'Cashbook & reconciliation', { sensitive: true }),
      part('accounting.cheques.view', 'accounting', 'See the cheque register', { enforcement: 'server', builtIn: ['director', 'admin_officer', 'finance_officer'] }),
      part('accounting.cheques.manage', 'accounting', 'Add cheques and mark them banked, cleared or bounced', { enforcement: 'server', builtIn: ['director', 'admin_officer', 'finance_officer'] }),
      part('accounting.journals', 'accounting', 'Accounting entries', { sensitive: true }),
      part('accounting.coa', 'accounting', 'Chart of accounts'),
      part('accounting.analytics', 'accounting', 'Analytic accounting & budgets'),
      part('accounting.gl', 'accounting', 'General ledger', { sensitive: true }),
      part('accounting.partner_ledger', 'accounting', 'Customer & supplier ledger'),
      part('accounting.integrity', 'accounting', 'Integrity controls'),
      part('accounting.migration', 'accounting', 'Data migration'),
      part('accounting.reports', 'accounting', 'Financial reports', { sensitive: true }),
      action('postFinancial', 'accounting', 'Post journals and customer payments', { sensitive: true }),
      action('recordPayment', 'accounting', 'Record customer payments and collections'),
      action('manageBankRecon', 'accounting', 'Bank accounts, statements and reconciliation', { sensitive: true }),
      action('manageCustomerCredit', 'accounting', 'Customer credit ledger'),
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    module: 'inventory',
    items: [
      part('inventory.catalog', 'inventory', 'Product catalog'),
      part('inventory.product_master', 'inventory', 'Product master'),
      part('inventory.warehouse', 'inventory', 'Warehouse stock'),
      part('inventory.movements', 'inventory', 'Stock movements'),
      part('inventory.parts_requests', 'inventory', 'Parts requests'),
      part('inventory.opening_stock', 'inventory', 'Opening stock'),
      part('inventory.stock_in', 'inventory', 'Stock in (receiving)'),
      part('inventory.stock_out', 'inventory', 'Stock out and checkouts'),
      part('inventory.transfers', 'inventory', 'Transfers'),
      part('inventory.adjustments', 'inventory', 'Adjustments'),
      part('inventory.stock_take', 'inventory', 'Stock take'),
      part('inventory.reports', 'inventory', 'Inventory reports'),
      action('manageInventoryApprovals', 'inventory', 'Approve stock adjustments and requests'),
      action('editSerialNumber', 'inventory', 'Edit serial numbers'),
      action('printInventoryLabels', 'inventory', 'Print product and serial labels'),
      action('viewVendorInventoryLedger', 'inventory', 'See the vendor stock ledger'),
    ],
  },
  {
    id: 'purchase',
    label: 'Purchases',
    module: 'purchase',
    items: [
      action('managePurchaseOrders', 'purchase', 'Create and change purchase orders'),
      action('validatePurchaseReceipt', 'purchase', 'Validate goods received notes'),
      action('manageProcurement', 'purchase', 'Return goods to vendors'),
      action('viewPurchaseCost', 'purchase', 'See purchase costs', { sensitive: true }),
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    module: 'sales',
    items: [
      action('manageSaleOrders', 'sales', 'Create and change quotations and sales orders'),
      action('requestSalesApproval', 'sales', 'Ask for discount and credit approvals'),
      action('approveDiscount', 'sales', 'Approve discounts and credit', { sensitive: true }),
      action('recordSales', 'sales', 'Record invoices, POS sales and refunds'),
      action('createCustomerInvoiceFromSO', 'sales', 'Create an invoice from a sales order'),
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    module: 'delivery',
    items: [action('manageDeliveries', 'delivery', 'Create and validate deliveries')],
  },
  {
    id: 'repair',
    label: 'Repairs',
    module: 'repair',
    items: [action('recordRepairBilling', 'repair', 'Bill repairs and repair quotes')],
  },
  {
    id: 'reconfiguration',
    label: 'Device reconfiguration',
    module: 'reconfiguration',
    items: [
      action('viewReconfiguration', 'reconfiguration', 'See reconfiguration work'),
      action('createReconfiguration', 'reconfiguration', 'Start a reconfiguration'),
      action('editReconfigurationDraft', 'reconfiguration', 'Edit a draft reconfiguration'),
      action('reserveReconfigurationComponents', 'reconfiguration', 'Reserve components'),
      action('approveReconfiguration', 'reconfiguration', 'Approve a reconfiguration'),
      action('performReconfigRemoval', 'reconfiguration', 'Remove components'),
      action('performReconfigInstallation', 'reconfiguration', 'Install components'),
      action('completeReconfigQa', 'reconfiguration', 'Sign off the quality check'),
      action('completeReconfiguration', 'reconfiguration', 'Complete a reconfiguration'),
      action('reverseReconfiguration', 'reconfiguration', 'Reverse a reconfiguration'),
      action('overrideReconfigCompatibility', 'reconfiguration', 'Override a compatibility warning'),
      action('overrideReconfigStock', 'reconfiguration', 'Override a stock shortage'),
      action('overrideMinimumMargin', 'reconfiguration', 'Override the minimum margin', { sensitive: true }),
      action('viewReconfigComponentCosts', 'reconfiguration', 'See component costs', { sensitive: true }),
      action('viewReconfigSellingPrices', 'reconfiguration', 'See selling prices'),
      action('viewReconfigAccounting', 'reconfiguration', 'See the accounting entries', { sensitive: true }),
    ],
  },
  {
    id: 'expenses',
    label: 'Expenses',
    module: 'expenses',
    items: [action('manageExpenses', 'expenses', 'Submit and manage expense claims')],
  },
  {
    id: 'deposits',
    label: 'Deposits & layby',
    module: 'deposits',
    items: [action('manageDeposits', 'deposits', 'Manage deposits and layby')],
  },
  {
    id: 'company_property',
    label: 'Asset management',
    module: 'company_property',
    items: [
      action('viewCompanyProperty', 'company_property', 'See company assets'),
      action('manageCompanyProperty', 'company_property', 'Add and change company assets'),
    ],
  },
  {
    id: 'hr',
    label: 'HR & payroll',
    module: 'hr',
    items: [
      action('manageHR', 'hr', 'Manage employees and HR records'),
      action('viewHrRecords', 'hr', 'See HR records (leave, documents)'),
      action('approveLeave', 'hr', 'Decide leave requests'),
      action('viewEmployeeSensitive', 'hr', 'See salary, bank and ID details', { sensitive: true }),
      action('managePayroll', 'hr', 'Run payroll and payslips', { sensitive: true }),
      action('approvePayroll', 'hr', 'Approve payroll', { sensitive: true }),
    ],
  },
  {
    id: 'admin',
    label: 'Settings & administration',
    items: [
      action('manageUsers', 'admin', 'Create users and manage roles', { sensitive: true }),
      action('viewUsers', 'admin', 'See the user list'),
      action('manageMasterData', 'admin', 'Change master data (contacts, products setup)'),
      action('viewAuditLog', 'admin', 'Read the audit trail', { sensitive: true }),
      action('appendAuditLog', 'admin', 'Write audit entries'),
    ],
  },
]

export const PERMISSION_CATALOG: PermissionDef[] = PERMISSION_GROUPS.flatMap(group => group.items)

export const PERMISSION_BY_KEY: Record<string, PermissionDef> = Object.fromEntries(PERMISSION_CATALOG.map(def => [def.key, def]))

export const isKnownPermission = (key: string) => Object.prototype.hasOwnProperty.call(PERMISSION_BY_KEY, key)

export const isNamedAction = (key: string): key is PermissionAction => Object.prototype.hasOwnProperty.call(ROLE_MATRIX, key)

/** Modules a permission group needs the person to be able to open. */
export const moduleOfPermission = (key: string): ModuleId | null => {
  const group = PERMISSION_GROUPS.find(g => g.items.some(item => item.key === key))
  return group?.module ?? null
}

/**
 * What a built-in role holds. `modules` are the modules that role opens (its
 * default list, or a user's own list), because parts of a module follow it.
 */
export function builtInPermissions(role: UserRole, modules: readonly string[]): string[] {
  const open = new Set(modules)
  return PERMISSION_CATALOG.filter(def => {
    if (def.builtIn === 'module') {
      const module = PERMISSION_GROUPS.find(g => g.id === def.group)?.module
      return module ? open.has(module) : false
    }
    return def.builtIn.includes(role)
  }).map(def => def.key)
}
