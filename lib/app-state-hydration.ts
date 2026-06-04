const COMMON_APP_STATE_KEYS = [
  'deed_companySettings',
  'deed_systemSettings',
  'deed_notifications',
  'deed_profileImages',
]

const HR_APP_STATE_KEYS = [
  'deed_departments',
  'deed_contracts',
  'deed_customerContracts',
  'deed_hrDocuments',
  'deed_workflowApprovals',
  'deed_employeeAssets',
  'deed_leaveBalances',
  'deed_leaveRequests',
  'deed_jobPostings',
  'deed_candidates',
  'deed_trainingPrograms',
  'deed_employeeTrainings',
  'deed_hr_sops',
  'deed_hr_perf_targets',
]

const ROUTE_APP_STATE_KEYS: Record<string, string[]> = {
  '/': [
    'deed_products',
    'deed_invoices',
    'deed_repairs_v2',
    'deed_deliveryJobs',
    'deed_expenses',
    'deed_deposits',
    'deed_contacts',
  ],
  '/sales': ['deed_products', 'deed_invoices', 'deed_contacts', 'deed_warranties', 'deed_bulkStock', 'deed_stockReservations'],
  '/purchases': ['deed_products', 'deed_purchaseReturns', 'deed_contacts', 'deed_bulkStock'],
  '/purchase': ['deed_products', 'deed_purchaseReturns', 'deed_contacts', 'deed_bulkStock'],
  '/operations': ['deed_products', 'deed_bulkStock', 'deed_stockTransfers', 'deed_stockAdjustments', 'deed_stockReservations', 'deed_openingStockPosted'],
  '/inventory': ['deed_products', 'deed_bulkStock', 'deed_stockTransfers', 'deed_stockAdjustments', 'deed_stockReservations', 'deed_openingStockPosted'],
  '/repairs': ['deed_repairs_v2', 'deed_contacts', 'deed_products', 'deed_invoices'],
  '/contacts': ['deed_contacts'],
  '/hr': HR_APP_STATE_KEYS,
  '/finance': ['deed_journalEntries', 'deed_accounts', 'deed_bankAccounts', 'deed_bankRecons', 'deed_bankStatementLines', 'deed_invoices', 'deed_expenses', 'deed_deposits', 'deed_refundPayments', 'deed_posOrders', 'deed_payrollRuns', 'deed_purchaseOrders'],
  '/accounting': ['deed_journalEntries', 'deed_accounts', 'deed_bankAccounts', 'deed_bankRecons', 'deed_bankStatementLines', 'deed_invoices', 'deed_expenses', 'deed_deposits', 'deed_refundPayments', 'deed_posOrders', 'deed_payrollRuns', 'deed_purchaseOrders'],
  '/pos': ['deed_products', 'deed_posOrders', 'deed_posSessionOpen', 'deed_posSessionOpeningCash', 'deed_bulkStock', 'deed_stockReservations'],
  '/delivery': ['deed_riders', 'deed_deliveryJobs', 'deed_riderWeeklyPays', 'deed_invoices', 'deed_contacts'],
  '/aftersales': ['deed_returnOrders', 'deed_refundPayments', 'deed_buyBacks', 'deed_donations', 'deed_clientExchanges', 'deed_warranties', 'deed_contacts', 'deed_invoices'],
  '/after_sales': ['deed_returnOrders', 'deed_refundPayments', 'deed_buyBacks', 'deed_donations', 'deed_clientExchanges', 'deed_warranties', 'deed_contacts', 'deed_invoices'],
  '/refurbishment': ['deed_refurbishmentJobs', 'deed_products', 'deed_bulkStock', 'deed_ref_sops'],
  '/kilimall': ['deed_kilimallOrders', 'deed_kilimallDispatches', 'deed_kilimallSettlements', 'deed_products', 'deed_bulkStock'],
  '/ecommerce': ['deed_products', 'deed_invoices', 'deed_contacts', 'deed_warranties'],
  '/expenses': ['deed_expenses', 'deed_accounts', 'deed_bankAccounts'],
  '/outsource': ['deed_outsourceVendors', 'deed_outsourceJobs', 'deed_outsourcePayments', 'deed_contacts'],
  '/deposits': ['deed_deposits', 'deed_invoices', 'deed_contacts', 'deed_bankAccounts'],
  '/documents': ['deed_hrDocuments', 'deed_sops', 'deed_sopActuals', 'deed_ref_sops', 'deed_hr_sops'],
  '/holdovers': ['deed_products', 'deed_bulkStock', 'deed_contacts'],
  '/settings': ['deed_companySettings', 'deed_systemSettings', 'deed_departments', 'deed_profileImages'],
}

function normalizeRoute(pathname: string) {
  const clean = (pathname || '/').split('?')[0].split('#')[0]
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean || '/'
}

export function appStateKeysForRoute(pathname: string) {
  const route = normalizeRoute(pathname)
  const routeKeys = ROUTE_APP_STATE_KEYS[route] ?? []
  return Array.from(new Set([...COMMON_APP_STATE_KEYS, ...routeKeys]))
}
