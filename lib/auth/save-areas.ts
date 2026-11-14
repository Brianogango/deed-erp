/**
 * Saving data straight from the screens (the wholesale store sync: POST
 * /api/store and PUT /api/store/[key]). Each area is a permission in the role
 * editor ("Save …"); the built-in roles hold it exactly as the old role lists
 * did. A person must also be able to open one of the area's modules.
 *
 * Every client-writable key registered in app-state-hydration.ts is listed
 * once; a new key is refused until it is added here. Dedicated APIs still
 * decide finer row/field/state-transition rules.
 */
import type { UserRole } from './types'

export type SaveArea = {
  /** Permission key; HR records use the existing manageHR. */
  key: string
  label: string
  /** Built-in roles that hold it. */
  roles: readonly UserRole[]
  /** Modules that let a person reach it (any one). None: the permission alone. */
  modules?: readonly string[]
  /** A key, or [key, its own modules] when they differ from the area's. */
  storeKeys: readonly (string | readonly [string, readonly string[]])[]
}

const D = ['director'] as const
const ADMIN = [...D, 'admin_officer'] as const
const FINANCE = [...ADMIN, 'finance_officer'] as const
const SALES = [...FINANCE, 'sales_rep', 'kilimall_officer', 'technical_lead'] as const
const INVENTORY = [...ADMIN, 'inventory_officer', 'technical_lead'] as const
const REPAIR = [...FINANCE, 'technical_lead', 'technician'] as const
const OPERATIONS = [...FINANCE, 'inventory_officer', 'technical_lead'] as const
const EVERYONE = [...FINANCE, 'inventory_officer', 'kilimall_officer', 'sales_rep', 'technical_lead', 'technician'] as const

const area = (key: string, label: string, roles: readonly UserRole[], modules: readonly string[] | undefined, storeKeys: SaveArea['storeKeys']): SaveArea =>
  ({ key, label, roles, modules, storeKeys })

export const SAVE_AREAS: readonly SaveArea[] = [
  // Settings. No module named 'settings' exists: the permission is the rule.
  area('save.settings.company', 'Save company settings', ADMIN, undefined, ['deed_companySettings']),
  area('save.settings.system', 'Save system settings', D, undefined, ['deed_systemSettings']),
  area('save.profile_images', 'Save profile photos', EVERYONE, undefined, ['deed_profileImages']),
  area('save.sops', 'Save SOPs', ADMIN, ['sops'], ['deed_sops']),
  area('save.sops.actuals', 'Record SOP actuals', EVERYONE, ['sops'], ['deed_sopActuals']),
  area('save.sops.refurbishment', 'Save refurbishment SOPs', REPAIR, ['sops', 'refurbishment'], ['deed_ref_sops']),

  // HR
  area('save.hr.departments', 'Save departments and HR SOPs', ADMIN, ['hr', 'sops'], [['deed_departments', ['hr']], 'deed_hr_sops']),
  area('manageHR', 'Manage HR records', D, ['hr'], [
    'deed_contracts', ['deed_hrDocuments', ['hr', 'my_documents']], 'deed_employeeAssets', 'deed_leaveBalances', ['deed_leaveRequests', ['hr', 'leave']], 'deed_salaryAdvances',
    'deed_jobPostings', 'deed_candidates', 'deed_trainingPrograms', 'deed_employeeTrainings', 'deed_hr_perf_targets',
  ]),
  area('save.payroll', 'Save payroll runs', FINANCE, ['hr', 'accounting'], ['deed_payrollRuns']),

  // Inventory
  area('save.inventory.products', 'Save products, serials and stock levels', INVENTORY, ['inventory'],
    // A repair trade-in registers the customer's device serial from the repair screen.
    ['deed_products', 'deed_productPriceHistory', ['deed_serials', ['inventory', 'repair']], 'deed_bulkStock', 'deed_openingStockPosted']),
  area('save.inventory.moves', 'Save stock moves, transfers and adjustments', OPERATIONS, ['inventory'], ['deed_stockTransfers', 'deed_stockAdjustments', ['deed_stockMoves', ['inventory', 'pos']]]),
  area('save.inventory.reservations', 'Reserve stock', [...INVENTORY, 'sales_rep'], ['inventory', 'sales', 'pos'], ['deed_stockReservations']),

  // Purchase
  area('save.purchase.orders', 'Save purchase orders', [...INVENTORY, 'finance_officer'], ['purchase'], ['deed_purchaseOrders']),
  area('save.purchase.receipts', 'Save goods receipts and purchase returns', INVENTORY, ['purchase'], [['deed_receipts', ['purchase', 'inventory']], 'deed_purchaseReturns']),

  // Sales, CRM, contacts
  area('save.sales.orders', 'Save quotations, sale orders and approval requests', SALES, ['sales'], ['deed_saleOrders', ['deed_quotes', ['sales', 'crm']], 'deed_approvalRequests']),
  area('save.sales.invoices', 'Save invoices from the screens', [...FINANCE, 'sales_rep', 'technical_lead'], ['sales', 'accounting', 'repair'], ['deed_invoices']),
  area('save.sales.warranties', 'Save warranties', [...SALES, 'technician'], ['sales', 'repair', 'after_sales'], ['deed_warranties']),
  area('save.sales.workflow', 'Save workflow approvals', FINANCE, ['sales', 'accounting'], ['deed_workflowApprovals']),
  area('save.crm.contracts', 'Save customer contracts', [...ADMIN, 'sales_rep'], ['crm', 'sales'], ['deed_customerContracts']),
  area('save.crm.pipeline', 'Save companies and opportunities', SALES, ['crm'], ['deed_companies', 'deed_opportunities']),
  area('save.contacts', 'Save contacts', [...SALES, 'inventory_officer'],
    ['contacts', 'crm', 'sales', 'purchase', 'pos', 'repair', 'delivery', 'after_sales', 'outsource', 'accounting'], ['deed_contacts']),
  area('save.pos', 'Save POS orders and sessions', [...FINANCE, 'sales_rep', 'kilimall_officer'], ['pos'],
    ['deed_posOrders', 'deed_posSessionOpen', 'deed_posSessionOpeningCash', 'deed_posSessionId', 'deed_posSessions']),
  area('save.holdovers', 'Save device holdovers', [...SALES, 'inventory_officer'], ['holdovers'], ['deed_holdovers']),

  // After-sales
  area('save.after_sales.returns', 'Save returns and exchanges', [...FINANCE, 'sales_rep', 'technical_lead'], ['after_sales'], ['deed_returnOrders', 'deed_clientExchanges']),
  // Trade-ins are booked by the desk, by inventory (the device comes into stock)
  // and raised from the repair screen; approving and paying stay Finance's.
  area('save.after_sales.buybacks', 'Save buy-backs (drafts and stocking)', [...FINANCE, 'sales_rep', 'technical_lead', 'inventory_officer'], ['after_sales', 'repair', 'inventory'], ['deed_buyBacks']),
  area('save.after_sales.refunds', 'Save refund payments', [...FINANCE, 'sales_rep'], ['after_sales', 'accounting'], ['deed_refundPayments']),
  area('save.after_sales.donations', 'Save donations', ADMIN, ['after_sales'], ['deed_donations']),

  // Kilimall
  area('save.kilimall.orders', 'Save Kilimall orders', [...ADMIN, 'kilimall_officer'], ['kilimall'], ['deed_kilimallOrders']),
  area('save.kilimall.dispatches', 'Save Kilimall dispatches', [...ADMIN, 'kilimall_officer', 'inventory_officer'], ['kilimall'], ['deed_kilimallDispatches']),
  area('save.kilimall.settlements', 'Save Kilimall settlements', [...FINANCE, 'kilimall_officer'], ['kilimall'], ['deed_kilimallSettlements']),

  // Delivery
  area('save.delivery', 'Save deliveries and delivery jobs', [...INVENTORY, 'sales_rep'], ['delivery'], [['deed_deliveries', ['delivery', 'sales']], 'deed_deliveryJobs']),
  area('save.delivery.riders', 'Save riders', ADMIN, ['delivery'], ['deed_riders']),
  area('save.delivery.rider_pay', 'Save rider weekly pay', FINANCE, ['delivery', 'hr'], ['deed_riderWeeklyPays']),

  // Repairs, refurbishment, outsourcing
  // Outsourcing a repair also saves the repair (held "in repair" at the vendor),
  // and inventory officers send stock units out too.
  area('save.repair.jobs', 'Save repairs and outsource jobs', [...REPAIR, 'inventory_officer'], ['repair', 'outsource'], ['deed_repairs_v2', 'deed_outsourceJobs']),
  area('save.repair.releases', 'Save outbound releases', REPAIR, ['repair', 'after_sales'], ['deed_outboundReleases']),
  area('save.repair.refurbishment', 'Save refurbishment jobs', REPAIR, ['refurbishment', 'repair'], ['deed_refurbishmentJobs']),
  // The job form can add a vendor in place.
  area('save.outsource.vendors', 'Save outsource vendors', [...ADMIN, 'technical_lead', 'inventory_officer'], ['outsource', 'repair'], ['deed_outsourceVendors']),
  area('save.outsource.payments', 'Save outsource payments', FINANCE, ['outsource', 'accounting'], ['deed_outsourcePayments']),

  // Finance
  area('save.accounting.books', 'Save payments, customer credits, accounts and journals', FINANCE, ['accounting'],
    [['deed_payments', ['accounting', 'sales']], ['deed_customerCredits', ['accounting', 'sales']], 'deed_accounts', 'deed_bankAccounts', 'deed_journalEntries']),
  area('save.accounting.bank_recon', 'Save bank reconciliations and statement lines', ['director', 'finance_officer'], ['accounting'], ['deed_bankRecons', 'deed_bankStatementLines']),
  // The bank or till printed on a quotation is chosen by whoever prepares it.
  area('save.accounting.document_payment_details', 'Choose payment details printed on documents', [...FINANCE, 'sales_rep'], ['accounting', 'sales'], ['deed_documentPaymentDetails']),
  area('save.expenses', 'Save expense claims', EVERYONE, ['expenses', 'accounting'], ['deed_expenses']),
  area('save.deposits', 'Save deposits and laybys', FINANCE, ['deposits', 'accounting'], ['deed_deposits']),
  area('save.company_property', 'Save the company property register', ADMIN, ['company_property'], ['deed_companyAssets']),
]
