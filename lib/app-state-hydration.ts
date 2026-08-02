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
  'deed_salaryAdvances',
  'deed_jobPostings',
  'deed_candidates',
  'deed_trainingPrograms',
  'deed_employeeTrainings',
  'deed_hr_sops',
  'deed_hr_perf_targets',
]

const ROUTE_APP_STATE_KEYS: Record<string, string[]> = {
  // Dashboard KPIs — keep this lean. Heavy workshop/outbound payloads hydrate
  // when opening Repairs / Inventory so first paint after login stays fast.
  '/': [
    'deed_products',
    'deed_saleOrders',
    'deed_invoices',
    'deed_repairs_v2',
    'deed_expenses',
    'deed_deposits',
    'deed_contacts',
    'deed_purchaseOrders',
    'deed_stockTransfers',
    'deed_posOrders',
    'deed_accounts',
    'deed_bankAccounts',
  ],
  '/sales': ['deed_saleOrders', 'deed_quotes', 'deed_products', 'deed_serials', 'deed_invoices', 'deed_deliveries', 'deed_contacts', 'deed_warranties', 'deed_bulkStock', 'deed_stockReservations', 'deed_approvalRequests', 'deed_bankAccounts', 'deed_documentPaymentDetails'],
  // CRM needs companies/opportunities/contacts — not the full sales + stock catalogs.
  '/crm': [
    'deed_quotes',
    'deed_contacts',
    'deed_companies',
    'deed_contactPersons',
    'deed_opportunities',
    'deed_customerContracts',
    'deed_approvalRequests',
  ],
  '/purchases': ['deed_products', 'deed_purchaseOrders', 'deed_receipts', 'deed_invoices', 'deed_purchaseReturns', 'deed_contacts', 'deed_bulkStock', 'deed_serials'],
  '/purchase': ['deed_products', 'deed_purchaseOrders', 'deed_receipts', 'deed_invoices', 'deed_purchaseReturns', 'deed_contacts', 'deed_bulkStock', 'deed_serials'],
  '/operations': ['deed_products', 'deed_bulkStock', 'deed_stockTransfers', 'deed_stockAdjustments', 'deed_stockReservations', 'deed_openingStockPosted', 'deed_serials', 'deed_receipts', 'deed_refurbishmentJobs', 'deed_purchaseOrders'],
  '/inventory': ['deed_products', 'deed_productPriceHistory', 'deed_bulkStock', 'deed_stockTransfers', 'deed_stockAdjustments', 'deed_stockReservations', 'deed_openingStockPosted', 'deed_serials', 'deed_receipts', 'deed_refurbishmentJobs', 'deed_purchaseOrders'],
  '/repairs': ['deed_repairs_v2', 'deed_contacts', 'deed_products', 'deed_invoices', 'deed_serials', 'deed_refurbishmentJobs', 'deed_warranties', 'deed_outboundReleases', 'deed_outsourceJobs', 'deed_outsourceVendors'],
  '/contacts': ['deed_contacts'],
  '/hr': HR_APP_STATE_KEYS,
  '/finance': ['deed_journalEntries', 'deed_accounts', 'deed_bankAccounts', 'deed_bankRecons', 'deed_bankStatementLines', 'deed_invoices', 'deed_expenses', 'deed_deposits', 'deed_refundPayments', 'deed_posOrders', 'deed_payrollRuns', 'deed_purchaseOrders', 'deed_contacts', 'deed_products', 'deed_deliveries', 'deed_serials', 'deed_documentPaymentDetails'],
  '/accounting': ['deed_journalEntries', 'deed_accounts', 'deed_bankAccounts', 'deed_bankRecons', 'deed_bankStatementLines', 'deed_invoices', 'deed_expenses', 'deed_deposits', 'deed_refundPayments', 'deed_posOrders', 'deed_payrollRuns', 'deed_purchaseOrders', 'deed_contacts', 'deed_products', 'deed_deliveries', 'deed_serials', 'deed_documentPaymentDetails'],
  '/finance/invoices': ['deed_invoices', 'deed_bankAccounts', 'deed_documentPaymentDetails', 'deed_contacts', 'deed_saleOrders'],
  '/pos': ['deed_products', 'deed_serials', 'deed_contacts', 'deed_invoices', 'deed_posOrders', 'deed_posSessionOpen', 'deed_posSessionOpeningCash', 'deed_posSessionId', 'deed_posSessions', 'deed_bulkStock', 'deed_stockReservations', 'deed_journalEntries'],
  '/delivery': ['deed_riders', 'deed_deliveryJobs', 'deed_riderWeeklyPays', 'deed_invoices', 'deed_contacts'],
  '/aftersales': ['deed_returnOrders', 'deed_refundPayments', 'deed_buyBacks', 'deed_donations', 'deed_clientExchanges', 'deed_warranties', 'deed_contacts', 'deed_invoices'],
  '/after_sales': ['deed_returnOrders', 'deed_refundPayments', 'deed_buyBacks', 'deed_donations', 'deed_clientExchanges', 'deed_warranties', 'deed_contacts', 'deed_invoices'],
  '/refurbishment': ['deed_refurbishmentJobs', 'deed_products', 'deed_serials', 'deed_bulkStock', 'deed_ref_sops'],
  '/kilimall': ['deed_kilimallOrders', 'deed_kilimallDispatches', 'deed_kilimallSettlements', 'deed_products', 'deed_bulkStock'],
  '/ecommerce': ['deed_products', 'deed_invoices', 'deed_contacts', 'deed_warranties'],
  '/expenses': ['deed_expenses', 'deed_accounts', 'deed_bankAccounts'],
  '/outsource': ['deed_outsourceVendors', 'deed_outsourceJobs', 'deed_outsourcePayments', 'deed_contacts', 'deed_repairs_v2'],
  '/deposits': ['deed_deposits', 'deed_invoices', 'deed_contacts', 'deed_bankAccounts'],
  '/documents': ['deed_hrDocuments', 'deed_sops', 'deed_sopActuals', 'deed_ref_sops', 'deed_hr_sops'],
  '/holdovers': ['deed_holdovers', 'deed_products', 'deed_serials', 'deed_contacts', 'deed_repairs_v2', 'deed_bulkStock'],
  '/settings': ['deed_companySettings', 'deed_systemSettings', 'deed_departments', 'deed_profileImages'],
}

function normalizeRoute(pathname: string) {
  const clean = (pathname || '/').split('?')[0].split('#')[0]
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1)
  return clean || '/'
}

/** Longest-prefix match so nested routes inherit the parent key set. */
export function appStateKeysForRoute(pathname: string) {
  const route = normalizeRoute(pathname)
  let matched: string[] = []
  let matchedLen = -1
  for (const [key, keys] of Object.entries(ROUTE_APP_STATE_KEYS)) {
    if (route === key || (key !== '/' && route.startsWith(`${key}/`))) {
      if (key.length > matchedLen) {
        matched = keys
        matchedLen = key.length
      }
    }
  }
  if (route === '/') matched = ROUTE_APP_STATE_KEYS['/'] ?? []
  return Array.from(new Set([...COMMON_APP_STATE_KEYS, ...matched]))
}
