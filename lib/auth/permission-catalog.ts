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
  /**
   * A route permission that replaced a role list. Someone on a custom role is
   * decided by their base role for it, as before, until the role editor
   * lists it explicitly.
   */
  followsBaseRole?: boolean
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

/** A server route's permission that replaced a role list: same roles, now named. */
const route = (key: string, group: string, label: string, roles: readonly UserRole[]): PermissionDef => ({
  key,
  group,
  label,
  enforcement: 'server',
  builtIn: roles,
  followsBaseRole: true,
})

/** An action only the screens (and the store's save step) check: same roles, now named. */
const screen = (key: string, group: string, label: string, roles: readonly UserRole[]): PermissionDef => ({
  key,
  group,
  label,
  enforcement: 'screen',
  builtIn: roles,
  followsBaseRole: true,
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
      // Server routes (were role lists)
      route('accounting.view', 'accounting', 'See accounting reports and working screens (ageing, balance sheet, bank statements…)', ['director', 'admin_officer', 'finance_officer']),
      route('accounting.chart_setup.view', 'accounting', 'See the chart of accounts setup', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('accounting.ledger_repair', 'accounting', 'Run ledger repair tools (duplicate journals, bill-payment fixes, reopen a period)', ['director']),
      route('accounting.manage', 'accounting', 'Manage accounting: analytic accounts, budgets, bank statements, periods, journals', ['director', 'finance_officer']),
      route('invoices.manage', 'accounting', 'Send invoices, record their payments and supplier credits', ['director', 'admin_officer', 'finance_officer']),
      route('invoices.edit', 'accounting', 'Create and edit invoices', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
      route('invoices.payments.reverse', 'accounting', 'Reverse an invoice payment', ['director', 'finance_officer']),
      route('accounting.recurring_bills.manage', 'accounting', 'Manage recurring bills', ['director', 'finance_officer']),
      route('invoices.price_variance', 'accounting', 'Accept a bill price that differs from the order', ['director', 'finance_officer']),
      // Screen actions (were role lists)
      screen('accounting.customer_invoices.view', 'accounting', 'See customer invoices', ['director', 'admin_officer', 'finance_officer', 'kilimall_officer', 'sales_rep']),
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
      // Server routes (were role lists)
      route('inventory.categories.manage', 'inventory', 'Manage product categories', ['director', 'admin_officer', 'finance_officer']),
      route('inventory.reconcile', 'inventory', 'Run stock reconciliation', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      route('inventory.import', 'inventory', 'Import inbound stock and check table parity', ['director', 'admin_officer', 'inventory_officer']),
      route('inventory.serials.manage', 'inventory', 'Write off serials and normalise tags', ['director', 'admin_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.reconcile.apply', 'inventory', 'Apply stock reconciliation fixes', ['director']),
      route('inventory.products.edit', 'inventory', 'Edit products and their photos', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.products.create', 'inventory', 'Create products, bulk upload and clean up the catalog', ['director', 'admin_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.serials.bulk', 'inventory', 'Add serials in bulk', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.consignments.view', 'inventory', 'See consignment stock', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead', 'sales_rep']),
      route('inventory.consignments.manage', 'inventory', 'Book in, buy or hand back consignment stock', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.returns.apply', 'inventory', 'Put customer returns back into stock', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      route('inventory.vendor_returns.apply', 'inventory', 'Take vendor returns out of stock', ['director', 'admin_officer', 'inventory_officer']),
      route('inventory.opening_stock.validate', 'inventory', 'Check opening stock before posting', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.serial_holds', 'inventory', 'See and clear stale serial holds', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      route('inventory.checkouts.request', 'inventory', 'Request stock checkouts', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.checkouts.approve', 'inventory', 'Approve stock checkouts', ['director', 'inventory_officer', 'technical_lead']),
      route('inventory.computer_aid', 'inventory', 'Manage Computer Aid custody stock', ['director', 'admin_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.serials.intake', 'inventory', 'Take serials into stock', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.valuation.view', 'inventory', 'See the stock valuation report', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      route('inventory.sales_stock_check', 'inventory', 'Check stock against sales', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'kilimall_officer']),
      route('inventory.serial_count_check', 'inventory', 'Check serial counts', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      route('inventory.serials.edit', 'inventory', 'Edit serial records', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.stock_moves.edit', 'inventory', 'Record stock moves', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('inventory.pos_stock.apply', 'inventory', 'Take POS sales out of stock', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'kilimall_officer', 'sales_rep']),
      // Screen actions (were role lists)
      screen('inventory.stock_requests', 'inventory', 'Create and validate transfers; request adjustments', ['director', 'finance_officer', 'inventory_officer', 'technical_lead']),
      screen('inventory.serials.release', 'inventory', 'Release a held serial back to stock', ['director', 'admin_officer', 'inventory_officer']),
      screen('inventory.prices.update', 'inventory', 'Update product prices', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
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
      // Server routes (were role lists)
      route('purchase.rfq.send', 'purchase', 'Email RFQs to suppliers', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('purchase.vendor_accounts.view', 'purchase', 'See vendor expense accounts', ['director', 'admin_officer', 'finance_officer']),
      route('purchase.vendor_accounts.manage', 'purchase', 'Manage vendor expense accounts', ['director', 'finance_officer']),
      route('purchase.notify', 'purchase', 'Send procurement notifications by hand', ['director', 'admin_officer', 'technical_lead', 'technician']),
      route('purchase.receipts.edit', 'purchase', 'Create and edit goods receipts', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      // Screen actions (were role lists)
      screen('purchase.orders.revert', 'purchase', 'Move a sent purchase order back to draft', ['director', 'admin_officer']),
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
      // Server routes (were role lists)
      route('sales.agents.view', 'sales', 'See sales agents; add and cancel commission bills', ['director', 'admin_officer', 'finance_officer']),
      route('sales.agents.assign', 'sales', 'Assign sales agents to orders', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.agents.payouts', 'sales', 'Manage sales agents and pay their commissions', ['director', 'finance_officer']),
      route('sales.contacts.archive', 'sales', 'Archive and restore contacts', ['director', 'admin_officer']),
      route('sales.contacts.edit', 'sales', 'Create and edit contacts', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.contacts.merge', 'sales', 'Merge duplicate contacts', ['director']),
      route('sales.crm.merge_duplicates', 'sales', 'Resolve duplicate CRM contacts', ['director', 'admin_officer']),
      route('sales.crm.view_duplicates', 'sales', 'See duplicate CRM contacts', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.crm.email_review', 'sales', 'Review sales-inbox emails', ['director', 'admin_officer', 'sales_rep']),
      route('sales.quote.send', 'sales', 'Email quotes to customers', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep']),
      route('sales.kilimall.returns', 'sales', 'Record Kilimall order returns', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'kilimall_officer']),
      route('sales.opportunities.activities', 'sales', 'Log activities on opportunities', ['director', 'admin_officer', 'sales_rep']),
      route('sales.orders.reconfiguration', 'sales', 'Link reconfigurations to sale orders', ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'sales_rep']),
      route('sales.orders.deliver_held', 'sales', 'Release held deliveries', ['director']),
      route('sales.orders.credit_note', 'sales', 'Issue credit notes from sale orders', ['director', 'finance_officer']),
      route('sales.salespeople.view', 'sales', 'See the salespeople list', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'kilimall_officer', 'sales_rep']),
      route('sales.quotes.create', 'sales', 'Create quotations', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.quotes.edit', 'sales', 'Edit and delete quotations', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep']),
      route('sales.quote.notify', 'sales', 'Send quote notifications by hand', ['director', 'admin_officer', 'technical_lead', 'sales_rep']),
      route('sales.view_all', 'sales', 'See every salesperson’s records (without it, only your own)', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead', 'kilimall_officer', 'technician']),
      route('sales.orders.audit', 'sales', 'See a sale order’s audit trail', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      route('sales.orders.new_version', 'sales', 'Make a new version of a sale order', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.orders.deliver_lines', 'sales', 'Deliver sale order lines', ['director', 'admin_officer', 'inventory_officer', 'sales_rep']),
      route('sales.commissions.view_all', 'sales', 'See everyone’s sales commissions', ['director', 'admin_officer', 'finance_officer']),
      route('sales.leads.edit', 'sales', 'Create and edit leads', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.crm.email', 'sales', 'Send CRM emails', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      route('sales.opportunities.view', 'sales', 'See opportunities', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'kilimall_officer', 'sales_rep']),
      route('sales.opportunities.edit', 'sales', 'Create and edit opportunities', ['director', 'admin_officer', 'sales_rep']),
      route('sales.pos.backdate', 'sales', 'Post POS journals for another day', ['director', 'finance_officer']),
      route('sales.kilimall.reconcile', 'sales', 'Reconcile Kilimall serials', ['director', 'inventory_officer', 'kilimall_officer']),
      route('sales.credit_applications', 'sales', 'Work on customer credit applications', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      // Screen actions (were role lists)
      screen('sales.kilimall.orders', 'sales', 'Create Kilimall orders', ['director', 'kilimall_officer', 'sales_rep']),
      screen('sales.kilimall.dispatch', 'sales', 'Confirm Kilimall dispatches', ['director', 'inventory_officer', 'kilimall_officer']),
      screen('sales.kilimall.settlements', 'sales', 'Record Kilimall settlements', ['director', 'finance_officer', 'kilimall_officer']),
      screen('sales.orders.confirm', 'sales', 'Confirm a quotation into a sale order', ['director', 'admin_officer', 'sales_rep']),
      screen('sales.buyback.approve', 'sales', 'Approve buy-backs', ['director', 'finance_officer']),
      screen('sales.exchange.approve', 'sales', 'Approve exchanges', ['director', 'finance_officer']),
      screen('sales.aftersales.returns', 'sales', 'Manage customer returns (RMA)', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      screen('sales.aftersales.restock', 'sales', 'Put returned serials back into stock', ['director', 'admin_officer', 'inventory_officer']),
      screen('sales.crm.manage', 'sales', 'Manage CRM for the whole team (all owners, bulk actions)', ['director', 'admin_officer', 'finance_officer']),
      screen('sales.crm.assign', 'sales', 'Assign leads and opportunities', ['director', 'admin_officer']),
      screen('sales.contacts.credit_terms', 'sales', 'Set a contact’s credit limit and payment terms', ['director', 'finance_officer']),
      route('sales.orders.confirm_repair', 'sales', 'Confirm a repair-linked quotation into a sale order', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep']),
      route('sales.orders.reverse_confirmed', 'sales', 'Cancel or reset a confirmed sale order', ['director', 'admin_officer', 'finance_officer']),
      route('sales.orders.confirm_unreserved', 'sales', 'Confirm a sale order without reserving stock', ['director', 'inventory_officer']),
      route('sales.reports.view_all', 'sales', 'See everyone’s sales in sales reports', ['director', 'admin_officer', 'finance_officer']),
      route('sales.credit.review', 'sales', 'Review, approve, decline or suspend credit applications', ['director', 'finance_officer']),
      route('sales.credit.revoke', 'sales', 'Reinstate or revoke customer credit', ['director']),
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    module: 'delivery',
    items: [action('manageDeliveries', 'delivery', 'Create and validate deliveries'), action('manageRiderPay', 'delivery', 'See and settle rider weekly pay', { sensitive: true })],
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
      // Server routes (were role lists)
      route('delivery.reverse', 'delivery', 'Reverse a delivery', ['director', 'admin_officer', 'inventory_officer']),
      route('delivery.rider_cash', 'delivery', 'Record rider cash handed in and trip follow-ups', ['director', 'admin_officer', 'finance_officer']),
      route('delivery.rider_cash_fix', 'delivery', 'Correct rider cash records', ['director', 'finance_officer']),
      route('delivery.release.verify', 'delivery', 'Verify a release certificate', ['director', 'admin_officer']),
      route('delivery.release.audit', 'delivery', 'See a release certificate’s history', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'sales_rep']),
      route('delivery.release.manage', 'delivery', 'Start and work on release certificates', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep']),
      route('delivery.release.void_verified', 'delivery', 'Void a verified release certificate', ['director']),
      route('delivery.riders.link', 'delivery', 'Send riders their job link', ['director', 'admin_officer', 'finance_officer', 'inventory_officer']),
      // Server routes (were role lists)
      route('repair.quote.send', 'repair', 'Email repair quotes (includes technicians)', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep', 'technician']),
      route('repair.invoice.edit', 'repair', 'Create and edit repair invoices (includes technicians)', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'technician']),
      route('refurbishment.intake', 'repair', 'Take machines into refurbishment, harvest parts', ['director', 'admin_officer', 'inventory_officer', 'technical_lead']),
      route('refurbishment.identify', 'repair', 'Identify refurbishment machines and create variants', ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'technician']),
      route('repair.verify', 'repair', 'Verify repair intake', ['director', 'admin_officer', 'technical_lead']),
      route('repair.edit', 'repair', 'Work on repairs and their parts', ['director', 'admin_officer', 'technical_lead', 'technician']),
      route('repair.technicians.view', 'repair', 'See the technicians list', ['director', 'admin_officer', 'technical_lead']),
      route('repair.invoice.reissue', 'repair', 'Reissue a repair invoice', ['director', 'finance_officer']),
      route('repair.quotes.edit', 'repair', 'Create and edit repair quotations (includes technicians)', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep', 'technician']),
      route('delivery.trip.check_in', 'delivery', 'Check rider trips in', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead']),
      route('delivery.create', 'delivery', 'Create deliveries', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'sales_rep']),
      route('delivery.edit', 'delivery', 'Edit deliveries', ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead', 'sales_rep']),
      // Screen actions (were role lists)
      screen('repair.lead', 'repair', 'Lead decisions on any repair (QC, parts sign-off)', ['director', 'technical_lead']),
      screen('repair.manage', 'repair', 'Manage the repair workflow (stop at diagnosis, retain, trade-in)', ['director', 'admin_officer', 'technical_lead']),
      screen('repair.fee.mark_paid', 'repair', 'Mark a diagnosis fee paid', ['director', 'admin_officer', 'finance_officer', 'sales_rep']),
      screen('repair.fee.waive', 'repair', 'Waive a diagnosis fee', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
      screen('repair.quote.generate', 'repair', 'Generate, update or decline a repair quote', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep']),
      screen('repair.parts.arrived', 'repair', 'Mark repair parts arrived', ['director', 'admin_officer', 'inventory_officer', 'technical_lead']),
      screen('repair.view_all', 'repair', 'See every repair (not only your own)', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
      screen('repair.retained.donate', 'repair', 'Turn a retained device into a donation', ['director', 'admin_officer', 'inventory_officer', 'technical_lead']),
      screen('repair.warranty.cancel', 'repair', 'Cancel a warranty', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
      screen('repair.assign', 'repair', 'Assign technicians to repairs (the Director: when Settings allow it)', ['technical_lead']),
      screen('repair.close', 'repair', 'Close a delivered repair job', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
      screen('repair.progress.update', 'repair', 'Update the progress of any repair', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
      screen('repair.warranty.claim', 'repair', 'File a warranty claim from a repair', ['director', 'admin_officer', 'finance_officer']),
      screen('repair.intake.create', 'repair', 'Book in a new repair', ['director', 'admin_officer']),
      screen('refurbishment.view_all', 'repair', 'See every refurbishment job (not only your own)', ['director', 'admin_officer', 'technical_lead']),
      screen('repair.outsource.vendors', 'repair', 'Add and edit outsource vendors', ['director']),
      route('repair.billing.exempt', 'repair', 'Mark a repair as not billed (warranty, goodwill)', ['director', 'admin_officer', 'finance_officer', 'technical_lead']),
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
      // Server routes (were role lists)
      route('deposits.close', 'deposits', 'Complete or cancel a deposit', ['director', 'finance_officer']),
      // Server routes (were role lists)
      route('expenses.receipts.manage', 'expenses', 'Manage expense receipts of others', ['director', 'admin_officer', 'finance_officer']),
      route('expenses.post', 'expenses', 'Post expenses to the ledger', ['director', 'finance_officer']),
      route('expenses.receipts.remove', 'expenses', 'Remove an expense receipt', ['director', 'finance_officer']),
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
      // Server routes (were role lists)
      route('hr.employees.finance', 'hr', 'Edit employee pay details, history and final dues', ['director', 'finance_officer']),
      route('hr.documents.finance', 'hr', 'Open HR document files (Finance)', ['finance_officer']),
      // Screen actions (were role lists)
      screen('hr.assets.manage', 'hr', 'Assign and receive company equipment for employees', ['director', 'inventory_officer', 'technical_lead']),
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
      // Server routes (were role lists)
      route('admin.notifications', 'admin', 'Manage notification rules and templates; sign users out', ['director', 'admin_officer']),
      route('admin.system', 'admin', 'Run system maintenance (file store moves, reset)', ['director']),
      route('admin.ledger_checks', 'admin', 'Run ledger parity checks', ['director', 'finance_officer']),
      route('admin.jobs', 'admin', 'Run background jobs by hand (notifications, inbox, knowledge)', ['director', 'admin_officer']),
      route('admin.email', 'admin', 'Check and test the email connection', ['director', 'admin_officer']),
      route('admin.assistant_documents', 'admin', 'Add documents to the assistant', ['director', 'admin_officer']),
      route('admin.metrics', 'admin', 'See system performance metrics', ['director', 'admin_officer']),
      route('admin.partner_keys', 'admin', 'Manage partner API keys', ['director', 'admin_officer']),
      route('settings.approval_rules.view', 'admin', 'See approval rules', ['director', 'admin_officer', 'finance_officer', 'technical_lead', 'sales_rep']),
      route('settings.commercial', 'admin', 'Change approval rules, exchange rates, price lists and company settings', ['director', 'finance_officer']),
      route('admin.sms', 'admin', 'See and send SMS messages', ['director', 'admin_officer']),
      route('admin.security.view', 'admin', 'See the security overview', ['director', 'admin_officer', 'finance_officer']),
      route('admin.sops.manage', 'admin', 'Upload and remove SOP files', ['director', 'admin_officer', 'technical_lead']),
      // Screen actions (were role lists)
      screen('admin.settings.open', 'admin', 'Open Settings', ['director', 'admin_officer', 'finance_officer']),
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
  // The Director holds every permission.
  if (role === 'director') return PERMISSION_CATALOG.map(def => def.key)
  const open = new Set(modules)
  return PERMISSION_CATALOG.filter(def => {
    if (def.builtIn === 'module') {
      const module = PERMISSION_GROUPS.find(g => g.id === def.group)?.module
      return module ? open.has(module) : false
    }
    return def.builtIn.includes(role)
  }).map(def => def.key)
}
