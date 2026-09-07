const COMMON_APP_STATE_KEYS = [
  'deed_companySettings',
  'deed_systemSettings',
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
  // Dashboard KPIs need the same inputs as Operations / Finance so the
  // numbers do not disagree. Keep this list aligned with every collection
  // consumed by components/modules/Dashboard.tsx: stale or omitted datasets
  // must re-hydrate from the server instead of leaving an old local cache in
  // place.
  '/': [
    'deed_products',
    'deed_saleOrders',
    'deed_invoices',
    'deed_repairs_v2',
    'deed_expenses',
    'deed_deposits',
    'deed_contacts',
    'deed_accounts',
    'deed_bankAccounts',
    'deed_bankStatementLines',
    'deed_serials',
    'deed_bulkStock',
    'deed_posOrders',
    'deed_purchaseOrders',
    'deed_payrollRuns',
    'deed_stockTransfers',
    'deed_kilimallOrders',
    'deed_outsourceJobs',
    'deed_refurbishmentJobs',
    'deed_journalEntries',
  ],
  '/sales': ['deed_saleOrders', 'deed_quotes', 'deed_products', 'deed_serials', 'deed_invoices', 'deed_deliveries', 'deed_contacts', 'deed_warranties', 'deed_bulkStock', 'deed_stockReservations', 'deed_approvalRequests', 'deed_bankAccounts', 'deed_documentPaymentDetails', 'deed_customerCredits'],
  // CRM needs companies/opportunities/contacts — not the full sales + stock catalogs.
  // deed_saleOrders is included (lean fields only matter for the client-side
  // join below) so an opportunity's detail view can show the real Sales
  // module quotations/orders for that client — CRM's own deed_quotes are a
  // separate, mostly-unused document type never actually created from the
  // live Sales UI (which creates SaleOrders directly).
  '/crm': [
    'deed_quotes',
    'deed_contacts',
    'deed_companies',
    'deed_contactPersons',
    'deed_opportunities',
    'deed_customerContracts',
    'deed_approvalRequests',
    'deed_saleOrders',
    'deed_customerCredits',
  ],
  '/purchases': ['deed_products', 'deed_purchaseOrders', 'deed_receipts', 'deed_invoices', 'deed_purchaseReturns', 'deed_contacts', 'deed_bulkStock', 'deed_serials'],
  '/purchase': ['deed_products', 'deed_purchaseOrders', 'deed_receipts', 'deed_invoices', 'deed_purchaseReturns', 'deed_contacts', 'deed_bulkStock', 'deed_serials'],
  '/operations': ['deed_products', 'deed_bulkStock', 'deed_stockTransfers', 'deed_stockAdjustments', 'deed_stockReservations', 'deed_openingStockPosted', 'deed_serials', 'deed_receipts', 'deed_refurbishmentJobs', 'deed_purchaseOrders', 'deed_stockMoves'],
  '/inventory': ['deed_products', 'deed_productPriceHistory', 'deed_bulkStock', 'deed_stockTransfers', 'deed_stockAdjustments', 'deed_stockReservations', 'deed_openingStockPosted', 'deed_serials', 'deed_receipts', 'deed_refurbishmentJobs', 'deed_purchaseOrders', 'deed_stockMoves'],
  '/repairs': ['deed_repairs_v2', 'deed_contacts', 'deed_products', 'deed_invoices', 'deed_serials', 'deed_refurbishmentJobs', 'deed_warranties', 'deed_outboundReleases', 'deed_outsourceJobs', 'deed_outsourceVendors'],
  '/contacts': ['deed_contacts', 'deed_customerCredits'],
  '/hr': HR_APP_STATE_KEYS,
  '/finance': ['deed_journalEntries', 'deed_accounts', 'deed_bankAccounts', 'deed_bankRecons', 'deed_bankStatementLines', 'deed_invoices', 'deed_expenses', 'deed_deposits', 'deed_refundPayments', 'deed_posOrders', 'deed_payrollRuns', 'deed_purchaseOrders', 'deed_contacts', 'deed_products', 'deed_deliveries', 'deed_documentPaymentDetails', 'deed_deliveryJobs', 'deed_riders', 'deed_customerCredits'],
  '/accounting': ['deed_journalEntries', 'deed_accounts', 'deed_bankAccounts', 'deed_bankRecons', 'deed_bankStatementLines', 'deed_invoices', 'deed_expenses', 'deed_deposits', 'deed_refundPayments', 'deed_posOrders', 'deed_payrollRuns', 'deed_purchaseOrders', 'deed_contacts', 'deed_products', 'deed_deliveries', 'deed_documentPaymentDetails', 'deed_customerCredits'],
  '/finance/invoices': ['deed_invoices', 'deed_bankAccounts', 'deed_documentPaymentDetails', 'deed_contacts', 'deed_saleOrders', 'deed_deliveryJobs', 'deed_riders', 'deed_customerCredits'],
  '/pos': ['deed_products', 'deed_serials', 'deed_contacts', 'deed_invoices', 'deed_posOrders', 'deed_posSessionOpen', 'deed_posSessionOpeningCash', 'deed_posSessionId', 'deed_posSessions', 'deed_bulkStock', 'deed_stockReservations', 'deed_journalEntries', 'deed_stockMoves', 'deed_customerCredits'],
  '/delivery': ['deed_riders', 'deed_deliveryJobs', 'deed_riderWeeklyPays', 'deed_invoices', 'deed_contacts'],
  '/aftersales': ['deed_returnOrders', 'deed_refundPayments', 'deed_buyBacks', 'deed_donations', 'deed_clientExchanges', 'deed_warranties', 'deed_contacts', 'deed_invoices', 'deed_saleOrders', 'deed_products', 'deed_serials', 'deed_deliveries', 'deed_outboundReleases', 'deed_customerCredits'],
  '/after_sales': ['deed_returnOrders', 'deed_refundPayments', 'deed_buyBacks', 'deed_donations', 'deed_clientExchanges', 'deed_warranties', 'deed_contacts', 'deed_invoices', 'deed_saleOrders', 'deed_products', 'deed_serials', 'deed_deliveries', 'deed_outboundReleases', 'deed_customerCredits'],
  '/refurbishment': ['deed_refurbishmentJobs', 'deed_products', 'deed_serials', 'deed_bulkStock', 'deed_ref_sops'],
  '/kilimall': ['deed_kilimallOrders', 'deed_kilimallDispatches', 'deed_kilimallSettlements', 'deed_products', 'deed_bulkStock'],
  '/ecommerce': ['deed_products', 'deed_invoices', 'deed_contacts', 'deed_warranties'],
  '/expenses': ['deed_expenses', 'deed_accounts', 'deed_bankAccounts'],
  '/outsource': ['deed_outsourceVendors', 'deed_outsourceJobs', 'deed_outsourcePayments', 'deed_contacts', 'deed_repairs_v2'],
  '/deposits': ['deed_deposits', 'deed_invoices', 'deed_contacts', 'deed_bankAccounts'],
  '/documents': ['deed_hrDocuments', 'deed_sops', 'deed_sopActuals', 'deed_ref_sops', 'deed_hr_sops'],
  '/holdovers': ['deed_holdovers', 'deed_products', 'deed_serials', 'deed_contacts', 'deed_repairs_v2', 'deed_bulkStock'],
  '/property': ['deed_companyAssets', 'deed_accounts'],
  '/settings': ['deed_companySettings', 'deed_systemSettings', 'deed_departments', 'deed_profileImages'],
}


// Client-writable app-state keys are registered centrally. POST /api/store and
// PUT /api/store/[key] use this registry to reject arbitrary deed_* namespaces
// instead of turning any attacker-chosen key into a durable database row.
// deed_payments remains for the legacy collection CRUD path even though finance
// screens now read authoritative payment records through dedicated APIs.
const LEGACY_CLIENT_APP_STATE_KEYS = ['deed_payments']

export const ALL_CLIENT_APP_STATE_KEYS = Object.freeze(Array.from(new Set([
  ...COMMON_APP_STATE_KEYS,
  ...HR_APP_STATE_KEYS,
  ...Object.values(ROUTE_APP_STATE_KEYS).flat(),
  ...LEGACY_CLIENT_APP_STATE_KEYS,
])))

const ALL_CLIENT_APP_STATE_KEY_SET = new Set<string>(ALL_CLIENT_APP_STATE_KEYS)

export function isKnownClientAppStateKey(key: string): boolean {
  return ALL_CLIENT_APP_STATE_KEY_SET.has(key)
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

/**
 * Heavy collections that secondary widgets need, but that must not block the
 * first paint of the module. Fetched in a second /api/store GET after the
 * loading gate releases.
 *
 * Longest-prefix match, same as appStateKeysForRoute. An explicit empty list
 * on a nested route (e.g. /finance/invoices) overrides the parent.
 */
const DEFERRED_ROUTE_APP_STATE_KEYS: Record<string, string[]> = {
  '/': [
    'deed_serials',
    'deed_journalEntries',
    'deed_bankStatementLines',
    'deed_payrollRuns',
    'deed_stockTransfers',
    'deed_kilimallOrders',
    'deed_outsourceJobs',
    'deed_refurbishmentJobs',
  ],
  '/finance': [
    'deed_products',
    'deed_contacts',
    'deed_payrollRuns',
    'deed_posOrders',
    'deed_purchaseOrders',
    'deed_deliveries',
    'deed_deliveryJobs',
    'deed_riders',
  ],
  '/accounting': [
    'deed_products',
    'deed_contacts',
    'deed_payrollRuns',
    'deed_posOrders',
    'deed_purchaseOrders',
    'deed_deliveries',
    'deed_customerCredits',
  ],
  '/finance/invoices': ['deed_deliveryJobs', 'deed_riders'],
  '/sales': [
    'deed_serials',
    'deed_warranties',
    'deed_bulkStock',
    'deed_stockReservations',
    'deed_approvalRequests',
    'deed_documentPaymentDetails',
    'deed_deliveries',
    'deed_bankAccounts',
  ],
  '/pos': ['deed_journalEntries', 'deed_stockMoves'],
}

function matchRouteKeyList(pathname: string, table: Record<string, string[]>): string[] {
  const route = normalizeRoute(pathname)
  let matched: string[] | undefined
  let matchedLen = -1
  for (const [key, keys] of Object.entries(table)) {
    if (route === key || (key !== '/' && route.startsWith(`${key}/`))) {
      if (key.length > matchedLen) {
        matched = keys
        matchedLen = key.length
      }
    }
  }
  if (route === '/') matched = table['/'] ?? []
  return matched ?? []
}

export function deferredAppStateKeysForRoute(pathname: string): string[] {
  const all = new Set(appStateKeysForRoute(pathname))
  return matchRouteKeyList(pathname, DEFERRED_ROUTE_APP_STATE_KEYS).filter(key => all.has(key))
}

export function criticalAppStateKeysForRoute(pathname: string): string[] {
  const deferred = new Set(deferredAppStateKeysForRoute(pathname))
  return appStateKeysForRoute(pathname).filter(key => !deferred.has(key))
}
