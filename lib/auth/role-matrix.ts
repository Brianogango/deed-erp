/**
 * Who may do what, by built-in role. Shared (no server-only code) so the
 * Settings role editor, the screens and the server all read the same rules.
 */
import { HR_MANAGER_ROLES, LEAVE_APPROVER_ROLES } from './access'
import type { UserRole } from './types'

export const ROLE_MATRIX = {
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
  // Office furniture / fittings register — not trading stock, not HR custody.
  manageCompanyProperty:     ['director', 'admin_officer'] as UserRole[],
  viewCompanyProperty:       ['director', 'admin_officer', 'finance_officer'] as UserRole[],
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

export type PermissionAction = keyof typeof ROLE_MATRIX
