import { ReactNode, useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { type User, type ModuleId, type AuditLog, type LocationId } from './core'
import { DATA_VERSION, saveHoldoverToServer, draftInvoiceRef, addDays, saveInvoiceToServer, upsertBulkStock, calcStockByLocation, postSystemJournal, isDraftInvoiceRef, saveAccountToServer, applyLocalDraftSaleOrder, applySaleOrderPersistResult, calcSO, confirmingSaleOrderIds, fetchNextKilimallRef, patchSaleOrderPersist, requestWarrantySync, findProductIdentityDuplicate, productCreateLockKey, REPAIR_TERMINAL_STATUSES, repairInvoiceInFlight, calcPO, fetchNextDeliveryRef, LOCATIONS, fmtKes, seesCustomerInvoices, syncOrWarn } from './helpers'
import { getDirtyKeys, _pendingSync, _inFlightSyncKeys, useLS, sync, SESSION_AUDIT_LOG_LIMIT } from './sync'
import { appStateKeysForRoute } from '@/lib/app-state-hydration'
import { useRealtimeSync } from './use-realtime-sync'
import { syncRepairToPortal } from './repair-portal-sync'
import { useViewActions } from './view-actions'
import { useStoredSettingsMigrations } from './settings-migrations'
import { assignServerNumbers, withServerRef, ensureUniqueServerRef } from './server-numbering'
import { useBootApis } from './use-boot-apis'
import { mergePosOrdersRemoteState } from '@/lib/pos-orders-merge'
import { mergeSaleOrdersPreservingDraftEdits } from '@/lib/sale-order-draft-edits'
import { awaitRouteHydration, awaitStoreDownloads, downloadedThisSession } from '@/lib/store-freshness'
import { hasModuleAccess as userHasModuleAccess, getFirstAllowedModule } from '@/lib/auth/access'
import { type AppState } from './state'
import { type Contact, type Company, type ContactPerson, type Opportunity, type OpportunityActivity, type Quote, type SaleOrder, type KilimallOrder, type KilimallDispatch, type KilimallSettlement, type POSOrder, type POSSession } from './sales'
import { seedContacts, seedCompanies, seedOpportunities, seedOpportunityActivities, seedQuotes, seedProducts, seedSerials, seedSOs, seedDeliveries, seedInvoices, seedPOs, seedReceipts, seedTransfers, seedRefurbishmentJobs, seedRepairs, seedContracts, seedCustomerContracts, seedWorkflowApprovals, seedEmployeeAssetAssignments, seedPayrollRuns, seedPayslips, seedJournalEntries, seedAccounts, DEFAULT_BANK_ACCOUNTS, DEFAULT_COMPANY_SETTINGS, DEFAULT_SYSTEM_SETTINGS, seedWarranties, seedBulkStock, seedRiders, seedDeliveryJobs, seedSOPs, seedSopActuals, seedRefSOPs, seedExpenses, seedOutsourceVendors, seedOutsourceJobs, seedOutsourcePayments } from './initial-state'
import { normalizeCompaniesForClient } from '@/lib/company-normalization'
import { deriveContactPersons } from '@/lib/contact-person-derive'
import { mergeProductsRemoteState, mergeCatalogProducts } from '@/lib/catalog-merge'
import { type ProductPriceHistory, type SerialNumber, type RefurbishmentJob, type BulkStockLevel, type StockMove, type StockAdjustment, type OutboundRelease, type Holdover, type Product, type RefurbPart } from './inventory'
import { useInventoryDomainStore } from '@/hooks/useInventoryDomainStore'
import { CATEGORY_CONFIG } from '@/lib/product-categories'
import { isSerialOnlyCategory, inferTrackingMethod, buildInventoryBarcode, type TrackingMethod } from '@/lib/inventory-identifiers'
import { keepContainedRows } from '@/lib/same-content'
import { rememberServerBaseline } from '@/lib/store-baseline'
import { type Delivery, type Rider, type DeliveryJob, type RiderWeeklyPay } from './delivery'
import { type Invoice, type Payment, type CustomerCredit, type BankAccount, type BankRecon, type BankStatementLine, type RefundPayment, type Deposit, type InvoiceLine } from './finance'
import { type PurchaseOrder, type Receipt, type PurchaseReturn, type StockTransfer } from './purchasing'
import { OUTSOURCE_SERVICE_TYPES, type RepairOrder, type Warranty, type OutsourceJob } from './repairs'
import { useHrStore as useHrDomainStore } from '@/hooks/useHrStore'
import { type PayrollRun, type Payslip, type SalaryAdvance, type RefSOP, type HRSOP, type PerformanceTarget } from './hr'
import { type DocumentPaymentDetailsMap } from '@/lib/document-payment-details'
import { type CompanySettings, type SystemSettings } from './settings'
import { normalizeStoredDiagnosisFee, resolveDiagnosisFee } from '@/lib/diagnosis-fee'
import { type ReturnOrder, type BuyBack, type Donation, type ClientExchange } from './after-sales'
import { mergeCollectionById } from '@/lib/collection-merge'
import { isOpeningStockLocked, isOpeningStockMove } from '@/lib/inventory/opening-stock'
import { type StockReservation, type ApprovalRequest } from '@/lib/sales-flow-types'
import { type BootApiGroup } from '@/lib/boot-apis'
import { mergePosSessionsRemoteState, resolveOpenPosSessionId } from '@/lib/pos-session'
import { mergeNotificationsSticky, buildNotifyRows, type AppNotification, type NotifyUsersInput } from '@/lib/in-app-notifications'
import { type SOPDocument, type SOP, type SOPActual } from './sop'
import { type Expense } from './expenses'
import { type CompanyAsset } from '@/lib/company-property'
import { useNotificationStore } from '@/hooks/useNotificationStore'
import { uid, now } from './ids'
import { allocateDocNumberSync } from '@/lib/doc-numbers'
import { contactPaymentTermsDays } from '@/lib/due-date'
import { findRepairCatalogProduct, matchRepairDeviceSerial, buyBackConditionFromRepair } from '@/lib/repair-retain-convert'
import { type PartsRequest, type PartsRequestKind } from '@/lib/repair/parts-request'
import { refurbPartRequest, refurbPartAfterRequest } from '@/lib/refurbishment/parts-request'
import { isProvisionalDocRef, recordsNeedingNumbers } from '@/lib/doc-number-repair'
import { useRouteDataReady } from '@/lib/route-data-ready'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { awaitingIdentification } from '@/lib/refurbishment/unidentified'
import { quoteMatchesCustomer, shouldSyncQuoteCustomer, applyCustomerToQuote, shouldSyncSaleOrderCustomer, applyCustomerToSaleOrder, shouldSyncInvoiceCustomer, applyCustomerToInvoice } from '@/lib/sync-customer-documents'
import { buildInvoicePostingJournal, journalFromPpeDraft } from './journals'
import { normalizeOpportunitiesForClient } from '@/lib/opportunity-normalization'
import { normalizeSaleOrdersForClient } from '@/lib/odoo-sales-flow'
import { buildCapitaliseFromInventoryJournal, buildCapitaliseFromApJournal, type PpeJournalDraft } from '@/lib/accounting/ppe-journals'
import { shouldPostCapitaliseJournal } from '@/lib/company-property-ppe'

/** State, refs, effects and helpers of the store. The action modules and the provider read them through the returned object. */

export type StoreProviderProps = {
  children: ReactNode
  initialUser?: User | null
  initialUsers?: User[]
  initialModule?: ModuleId
  serverState?: Record<string, unknown>
}

/** State, refs, effects and helpers of the store. The action modules and the provider read them through the returned object. */
export function useStoreCore({
  children,
  initialUser = null,
  initialUsers = [],
  initialModule,
  serverState,
}: StoreProviderProps) {
  // Keep local ERP data through deploys. The server snapshot below is the
  // authority and will update changed keys without making modules appear empty
  // during a data-version bump.
  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem('deed_data_version') !== DATA_VERSION) {
        localStorage.setItem('deed_data_version', DATA_VERSION)
      }
    } catch {
      // Private mode / blocked storage must not crash the root shell.
    }
  }

  // Real-time sync (Server-Sent Events) and the boot hydration it carries.
  useRealtimeSync(serverState, update => setUsers(update))

  const [activeModule, setActiveModule] = useState<ModuleId>(() => {
    // Prefer explicitly passed initialModule (e.g. SSR), then localStorage, then default
    if (initialModule) return initialModule
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('activeModule') as ModuleId | null
      if (saved && initialUser && userHasModuleAccess(initialUser, saved)) return saved
    }
    return getFirstAllowedModule(initialUser)
  })
  // Always start open (matches SSR); correct to actual viewport width after hydration
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useEffect(() => { setSidebarOpen(window.innerWidth >= 1024) }, [])
  const [toast, setToast] = useState<AppState['toast']>(null)

  // Legacy & CRM
  const [contacts, setContacts] = useLS<Contact[]>('deed_contacts', seedContacts)
  const [companiesRaw, setCompanies] = useLS<Company[]>('deed_companies', seedCompanies)
  // Server rows arrive in the Prisma `clients` shape (no status, string
  // creditLimit) via boot fetch, app_state sync, or old localStorage snapshots.
  // Normalize once here so every consumer sees a well-formed Company.
  const companies = useMemo(() => normalizeCompaniesForClient(companiesRaw) as Company[], [companiesRaw])
  // Derived, not stored. A contact person is an individual contact with an
  // employer, so the directory is the only place either concept lives now.
  // Keeping the ContactPerson shape means every CRM call site — opportunity
  // and contract pickers, LeadScore, the detail panels — works unchanged.
  const contactPersons = useMemo(
    () => deriveContactPersons(
      contacts,
      id => contacts.find(c => c.id === id)?.name,
    ) as unknown as ContactPerson[],
    [contacts],
  )
  const [opportunities, setOpportunities] = useLS<Opportunity[]>('deed_opportunities', seedOpportunities)
  const [opportunityActivities, setOpportunityActivities] = useLS<OpportunityActivity[]>('deed_oppActivities', seedOpportunityActivities)
  const [quotes, setQuotes] = useLS<Quote[]>('deed_quotes', seedQuotes)
  
  // Products & Inventory — merge SSE/cross-tab writes instead of replacing the
  // list. A hard replace + immediate Prisma re-merge was flashing the catalog
  // (and wiping in-progress search results) on every stock/sync push.
  const [products, setProducts] = useLS('deed_products', seedProducts, {
    mergeRemote: (local, remote) => mergeProductsRemoteState(local as any[], remote as any[]) as typeof local,
  })
  const [productPriceHistory, setProductPriceHistory] = useLS<ProductPriceHistory[]>('deed_productPriceHistory', [])

  // The relational catalog (/api/products) is the source of truth for product
  // identity and commercial fields. Boot merge uses the lite endpoint (no serials).
  const productsNowRef = useRef(products)
  productsNowRef.current = products
  const refreshProductCatalog = useCallback(async () => {
    try {
      const rows = await useInventoryDomainStore.getState().refreshProducts()
      if (!Array.isArray(rows) || rows.length === 0) return 0
      // Merge into the server's product list, not the browser's start-up copy:
      // merged before that list arrived, every product looked new and the
      // whole catalog was uploaded on each page load.
      await awaitRouteHydration(['deed_products'])
      await awaitStoreDownloads(['deed_products'])
      const mergeInto = (prev: typeof products) => {
        const merged = mergeCatalogProducts(prev, rows, CATEGORY_CONFIG, { preserveClientOrder: true }) as any[]
        const healed = merged.map(p => {
          if (!isSerialOnlyCategory(p.category)) return p
          if (p.trackingMethod === 'SERIAL' && p.requiresSerial) return p
          return { ...p, trackingMethod: 'SERIAL' as TrackingMethod, requiresSerial: true }
        })
        // Same data with keys in another order, or only leaving out fields the
        // server keeps anyway, is not a change: saving it re-uploaded every
        // product on every page load.
        return keepContainedRows(prev as any[], healed) as typeof prev
      }
      const before = productsNowRef.current
      const next = mergeInto(before)
      if (next === before) return rows.length
      // The merged list is the server's own catalog: when this browser has no
      // unsaved product edits, it is what the server holds — not an edit to
      // upload. (A later edit is still saved, diffed against it.)
      const key = 'deed_products'
      if (!_pendingSync[key] && !_inFlightSyncKeys.has(key) && !getDirtyKeys().has(key)) {
        try { rememberServerBaseline(key, JSON.stringify(next)) } catch { /* the save path diffs as before */ }
      }
      setProducts(current => (current === before ? next : mergeInto(current)))
      return rows.length
    } catch {
      return 0
    }
  }, [setProducts])

  useEffect(() => {
    // mergeRemote already protects against stale shorter blobs. Only re-pull
    // Prisma when a remote payload looks empty/corrupt — not on every stock sync.
    let timer: ReturnType<typeof setTimeout> | null = null
    const onRemote = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key !== 'deed_products') return
      let remote: unknown
      try {
        remote = typeof detail.value === 'string' ? JSON.parse(detail.value) : detail.value
      } catch {
        return
      }
      if (Array.isArray(remote) && remote.length > 0) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refreshProductCatalog(), 400)
    }
    window.addEventListener('deed_remote_update', onRemote as EventListener)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('deed_remote_update', onRemote as EventListener)
    }
  }, [refreshProductCatalog])
  
  const [serials, setSerials] = useLS<SerialNumber[]>('deed_serials', seedSerials)
  
  // Sales & Invoicing
  const [saleOrders, setSaleOrders] = useLS<SaleOrder[]>('deed_saleOrders', seedSOs, {
    mergeRemote: (local, remote) =>
      mergeSaleOrdersPreservingDraftEdits(local as SaleOrder[], remote as SaleOrder[]) as SaleOrder[],
  })

  const [deliveries, setDeliveries] = useLS<Delivery[]>('deed_deliveries', seedDeliveries)

  const [invoices, setInvoices] = useLS<Invoice[]>('deed_invoices', seedInvoices)

  const [payments, setPayments] = useLS<Payment[]>('deed_payments', [])
  const [customerCredits, setCustomerCredits] = useLS<CustomerCredit[]>('deed_customerCredits', [])

  // Purchasing
  const [purchaseOrders, setPurchaseOrders] = useLS<PurchaseOrder[]>('deed_purchaseOrders', seedPOs)
  const [receipts, setReceipts] = useLS<Receipt[]>('deed_receipts', seedReceipts)

  const [stockTransfers, setStockTransfers] = useLS('deed_stockTransfers', seedTransfers)
  const [purchaseReturns, setPurchaseReturns] = useLS<PurchaseReturn[]>('deed_purchaseReturns', [])
  const [refurbishmentJobs, setRefurbishmentJobs] = useLS<RefurbishmentJob[]>('deed_refurbishmentJobs', seedRefurbishmentJobs)

  // Repairs
  const [repairs, setRepairs] = useLS<RepairOrder[]>('deed_repairs_v2', seedRepairs)

  // HR — employees, departments, leave, hrDocuments, recruitment, and training have
  // moved to hooks/useHrStore.ts (Zustand). `employees` is still read locally below
  // (via empRef) because payroll/asset actions that stay in this file need it.
  const [contracts] = useLS('deed_contracts', seedContracts)
  const [customerContracts, setCustomerContracts] = useLS('deed_customerContracts', seedCustomerContracts)
  const [workflowApprovals, setWorkflowApprovals] = useLS('deed_workflowApprovals', seedWorkflowApprovals)
  const [employeeAssetAssignments, setEmployeeAssetAssignments] = useLS('deed_employeeAssets', seedEmployeeAssetAssignments)

  const employees = useHrDomainStore(s => s.employees)

  // Sensitive: never stored in localStorage/app_state — fetched only for privileged roles
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>(seedPayrollRuns)
  const [payslips, setPayslips] = useState<Payslip[]>(seedPayslips)
  // Salary advances are relational (Prisma) — fetched from the dedicated API,
  // scoped server-side (HR/finance see all; an employee sees only their own).
  const [salaryAdvances, setSalaryAdvances] = useState<SalaryAdvance[]>([])

  // Accounting
  const [journalEntries, setJournalEntries] = useLS('deed_journalEntries', seedJournalEntries)
  const [accounts, setAccounts]             = useLS('deed_accounts', seedAccounts)
  const [bankAccounts, setBankAccountsState] = useLS<BankAccount[]>('deed_bankAccounts', DEFAULT_BANK_ACCOUNTS)
  const [documentPaymentDetails, setDocumentPaymentDetailsState] = useLS<DocumentPaymentDetailsMap>(
    'deed_documentPaymentDetails',
    {},
  )
  const [companySettings, setCompanySettings] = useLS<CompanySettings>('deed_companySettings', DEFAULT_COMPANY_SETTINGS)
  const [systemSettings, setSystemSettings] = useLS<SystemSettings>('deed_systemSettings', DEFAULT_SYSTEM_SETTINGS)

  useStoredSettingsMigrations(companySettings, setCompanySettings, systemSettings, setSystemSettings)

  const [dbApprovalRules, setDbApprovalRules] = useState<Array<{ approvalType: string; thresholds: { maxValue: number; requiredRoles: string[] }[]; isActive: boolean }>>([])

  // One-time: rewrite unpaid open repairs still stamped with legacy 1,500 / 2,500.
  useEffect(() => {
    setRepairs(prev => {
      let changed = false
      const next = prev.map(r => {
        const status = String(r.diagnosisFeeStatus ?? '')
        if (status === 'paid' || status === 'invoiced' || status === 'waived') return r
        const stored = Number(r.diagnosisFee)
        if (stored !== 1500 && stored !== 2500) return r
        const amount = normalizeStoredDiagnosisFee(r, systemSettings)
        const resolved = resolveDiagnosisFee(r, systemSettings)
        changed = true
        return {
          ...r,
          diagnosisFee: amount,
          diagnosisFeeStatus: resolved.status === 'applicable' ? 'applicable' : resolved.status === 'not_applicable' ? 'not_applicable' : r.diagnosisFeeStatus,
        }
      })
      return changed ? next : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [bankRecons, setBankRecons]           = useLS<BankRecon[]>('deed_bankRecons', [])
  const [bankStatementLines, setBankStatementLines] = useLS<BankStatementLine[]>('deed_bankStatementLines', [])

  // Kilimall
  const [kilimallOrders, setKilimallOrders]         = useLS<KilimallOrder[]>('deed_kilimallOrders', [])
  const [kilimallDispatches, setKilimallDispatches] = useLS<KilimallDispatch[]>('deed_kilimallDispatches', [])
  const [kilimallSettlements, setKilimallSettlements] = useLS<KilimallSettlement[]>('deed_kilimallSettlements', [])

  // Returns / RMA
  const [returnOrders, setReturnOrders] = useLS<ReturnOrder[]>('deed_returnOrders', [])
  const [refundPayments, setRefundPayments] = useLS<RefundPayment[]>('deed_refundPayments', [])

  // Buy-backs / Donations / Exchanges
  const [buyBacks, setBuyBacks]           = useLS<BuyBack[]>('deed_buyBacks', [])
  const [donations, setDonations]         = useLS<Donation[]>('deed_donations', [])
  const [clientExchanges, setClientExchanges] = useLS<ClientExchange[]>('deed_clientExchanges', [])

  // Inventory
  const [warranties, setWarranties]         = useLS('deed_warranties', seedWarranties)
  useEffect(() => {
    const onIssued = (e: Event) => {
      const rows = (e as CustomEvent<Warranty[]>).detail ?? []
      setWarranties(prev => {
        const have = new Set(prev.map(w => w.id))
        const fresh = rows.filter(w => w && !have.has(w.id))
        return fresh.length ? [...prev, ...fresh] : prev
      })
    }
    window.addEventListener('deed:warranties-issued', onIssued)
    return () => window.removeEventListener('deed:warranties-issued', onIssued)
  }, [setWarranties])
  const [bulkStock, setBulkStock]           = useLS<BulkStockLevel[]>('deed_bulkStock', seedBulkStock)
  const [openingStockPosted, setOpeningStockPosted] = useLS<boolean>('deed_openingStockPosted', false)
  
  const [stockMoves, setStockMoves] = useLS<StockMove[]>('deed_stockMoves', [], {
    mergeRemote: (local, remote) => mergeCollectionById(local as StockMove[], remote as StockMove[]),
  })

  // Heal lock when OPENING moves already exist (ops seed / missed flag sync).
  const openingStockLocked = isOpeningStockLocked(openingStockPosted, stockMoves)
  useEffect(() => {
    if (!openingStockPosted && stockMoves.some(isOpeningStockMove)) {
      setOpeningStockPosted(true)
    }
  }, [openingStockPosted, stockMoves, setOpeningStockPosted])
  
  const [stockAdjustments, setStockAdjustments] = useLS<StockAdjustment[]>('deed_stockAdjustments', [])
  const [stockReservations, setStockReservations] = useLS<StockReservation[]>('deed_stockReservations', [])

  // Route-scoped Prisma boot only — idle prefetch of other modules competed with first clicks.
  const bootedApiGroupsRef = useRef<Set<BootApiGroup>>(new Set())
  // Per-route boot fetches: each screen pulls only the collections it needs.
  useBootApis({ initialUser, refreshProductCatalog, bootedApiGroupsRef, setDbApprovalRules, setJournalEntries, setPayrollRuns, setPayslips, setSalaryAdvances })

  // POS — union-merge remote payloads so a stale SSE/tab cannot drop till tickets.
  const [posOrders, setPosOrders] = useLS<POSOrder[]>('deed_posOrders', [], {
    mergeRemote: (local, remote) => mergePosOrdersRemoteState(local as POSOrder[], remote as POSOrder[]),
  })
  const [posSessionOpen, setPosSessionOpen] = useLS<boolean>('deed_posSessionOpen', false)
  const [posSessionOpeningCash, setPosSessionOpeningCash] = useLS<number>('deed_posSessionOpeningCash', 0)
  const [posSessionId, setPosSessionId] = useLS<string | null>('deed_posSessionId', null)
  const [posSessions, setPosSessions] = useLS<POSSession[]>('deed_posSessions', [], {
    mergeRemote: (local, remote) => mergePosSessionsRemoteState(local as POSSession[], remote as POSSession[]),
  })

  // Keep the till open until Close Session. If the open flag survived without
  // a session id, recover it from history so Charge / Close still work.
  useEffect(() => {
    if (!posSessionOpen) return
    const recovered = resolveOpenPosSessionId({ posSessionOpen, posSessionId, posSessions })
    if (recovered && recovered !== posSessionId) setPosSessionId(recovered)
  }, [posSessionOpen, posSessionId, posSessions, setPosSessionId])

  // Approvals & Audit
  const [approvalRequests, setApprovalRequests] = useLS<ApprovalRequest[]>('deed_approvalRequests', [])
  // Audit log: session-local only, never persisted.
  //
  // This was a useLS collection, which meant every browser accumulated its own
  // copy forever. It is write-only in three separate ways: no screen reads it,
  // the server ignores client writes to deed_auditLogs (P0-SEC-002 — the real
  // record is written by /api/audit/commercial), and nothing trims it. It was
  // the largest single key in app_state at ~1.1 MB, and on the client it was
  // pure ballast pushing the localStorage quota over — the failure that cost
  // a week of half-written deliveries, payments and orders.
  //
  // The in-memory mirror stays so the optimistic UI and any same-session
  // reader keep working, capped so a long shift cannot grow it without bound.
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [notifications, setNotifications] = useLS<AppNotification[]>(
    'deed_notifications',
    [],
    { mergeRemote: mergeNotificationsSticky },
  )
  const [profileImages, setProfileImages]       = useLS<Record<string, string>>('deed_profileImages', {})

  // Delivery / Riders
  const [riders, setRiders]               = useLS<Rider[]>('deed_riders', seedRiders)
  const [deliveryJobs, setDeliveryJobs]   = useLS<DeliveryJob[]>('deed_deliveryJobs', seedDeliveryJobs)
  const [riderWeeklyPays, setRiderWeeklyPays] = useLS<RiderWeeklyPay[]>('deed_riderWeeklyPays', [])

  // SOP Documents
  const [sopDocuments, setSopDocuments] = useLS<SOPDocument[]>('deed_sop_documents', [])
  // Performance Targets
  const [sops, setSops]             = useLS<SOP[]>('deed_sops', seedSOPs)
  const [sopActuals, setSopActuals] = useLS<SOPActual[]>('deed_sopActuals', seedSopActuals)
  const [refSops, setRefSops]       = useLS<RefSOP[]>('deed_ref_sops', seedRefSOPs)

  // HR SOPs & Targets
  const [hrSops, setHrSops] = useLS<HRSOP[]>('deed_hr_sops', [])
  const [hrPerfTargets, setHrPerfTargets] = useLS<PerformanceTarget[]>('deed_hr_perf_targets', [])

  // Expenses & Outsource
  const [expenses, setExpenses]               = useLS<Expense[]>('deed_expenses', seedExpenses)
  const [outsourceVendors, setOutsourceVendors] = useLS('deed_outsourceVendors', seedOutsourceVendors)
  const [outsourceJobs, setOutsourceJobs]       = useLS('deed_outsourceJobs', seedOutsourceJobs)
  const [outsourcePayments, setOutsourcePayments] = useLS('deed_outsourcePayments', seedOutsourcePayments)
  const [outboundReleases, setOutboundReleases] = useLS<OutboundRelease[]>('deed_outboundReleases', [])
  const [deposits, setDeposits] = useLS<Deposit[]>('deed_deposits', [])
  const [companyAssets, setCompanyAssets] = useLS<CompanyAsset[]>('deed_companyAssets', [])
  const [holdovers, setHoldovers] = useLS<Holdover[]>('deed_holdovers', (() => {
    // One-time migrate from the legacy local-only key used before store sync.
    if (typeof window === 'undefined') return [] as Holdover[]
    try {
      const legacy = window.localStorage.getItem('deed_holdovers_v1')
      if (!legacy) return [] as Holdover[]
      const parsed = JSON.parse(legacy)
      return Array.isArray(parsed) ? (parsed as Holdover[]) : []
    } catch {
      return [] as Holdover[]
    }
  })())

  // Merge any remaining legacy local-only holdovers into the synced key, then drop v1.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const legacyRaw = window.localStorage.getItem('deed_holdovers_v1')
      if (!legacyRaw) return
      const legacy = JSON.parse(legacyRaw)
      if (!Array.isArray(legacy) || legacy.length === 0) {
        window.localStorage.removeItem('deed_holdovers_v1')
        return
      }
      // Saved to the server; they show up once the list next loads.
      const legacyRows = (legacy as Holdover[]).filter(h => h?.id)
      void Promise.all(legacyRows.map(h => saveHoldoverToServer('POST', '/api/holdovers', h))).then(results => {
        if (results.every(r => typeof r !== 'string')) window.localStorage.removeItem('deed_holdovers_v1')
      })
    } catch {
      /* ignore corrupt legacy */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [users, setUsers] = useState<User[]>(() => {
    // This logic is now mostly handled by the server session, but we keep it for hydration
    if (!initialUser && initialUsers.length === 0) return []

    const candidates = [...initialUsers]

    if (initialUser && !candidates.some(user => user.id === initialUser.id)) {
      candidates.unshift(initialUser)
    }

    return candidates.map(user => ({ ...user, modules: Array.isArray(user.modules) ? [...user.modules] : [] }))
  })
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialUser?.id ?? null)

  const showToast = useCallback((msg: string, type: 'success'|'error'|'info' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500)
    // Fan into the Zustand toast slice for domain hooks. AppShell still renders
    // the Context toast — do not mount a second Toast from this store.
    useNotificationStore.getState().showToast(msg, type)
  }, [])

  // ── Internal notification pusher (single-recipient compat + multi fan-out) ──
  const notifyUsers = useCallback((input: NotifyUsersInput) => {
    setNotifications(prev => buildNotifyRows(prev, input, uid).next)
    fetch('/api/notifications/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).catch(() => {})
  }, [])

  const pushNotif = useCallback((n: Omit<AppNotification, 'id' | 'createdAt' | 'read' | 'readAt'> & { excludeUserId?: string | null }) => {
    notifyUsers({
      recipients: [n.userId],
      type: n.type,
      title: n.title,
      body: n.body,
      module: n.module,
      path: n.path,
      icon: n.icon,
      entityKey: n.entityKey,
      excludeUserId: n.excludeUserId,
    })
  }, [notifyUsers])


  // Keep refs for current state in closures
  const prodRef   = useRef(products);   prodRef.current   = products
  const productCreateLocksRef = useRef(new Set<string>())
  const accountRef = useRef(accounts);  accountRef.current = accounts
  const serialRef = useRef(serials);    serialRef.current = serials
  const repairsRef = useRef(repairs); repairsRef.current = repairs
  const soRef      = useRef(saleOrders); soRef.current   = saleOrders
  const invRef    = useRef(invoices);  invRef.current    = invoices
  const poRef     = useRef(purchaseOrders); poRef.current = purchaseOrders
  /** Purchase orders being confirmed right now (double-click guard). */
  const confirmingPoRef = useRef(new Set<string>())
  /**
   * Till ticket numbers of POS sales whose stock call did not come back
   * (network drop, server error), keyed by session + cart. Charging the same
   * cart again reuses the number, so a sale the server did take is not taken
   * twice; a refused sale (stock gone) frees it.
   */
  const posPendingRefs = useRef(new Map<string, string>())
  const recRef    = useRef(receipts);   recRef.current    = receipts
  const purchaseReturnsRef = useRef(purchaseReturns); purchaseReturnsRef.current = purchaseReturns
  const warRef    = useRef(warranties); warRef.current    = warranties
  const delRef    = useRef(deliveries); delRef.current    = deliveries
  const orcRef    = useRef(outboundReleases); orcRef.current = outboundReleases
  const adjRef    = useRef(stockAdjustments); adjRef.current = stockAdjustments
  const empRef    = useRef(employees); empRef.current = employees
  const payrollRef = useRef(payrollRuns); payrollRef.current = payrollRuns
  const salaryAdvancesRef = useRef(salaryAdvances); salaryAdvancesRef.current = salaryAdvances
  const assetRef = useRef(employeeAssetAssignments); assetRef.current = employeeAssetAssignments
  const kilimallOrdersRef = useRef(kilimallOrders); kilimallOrdersRef.current = kilimallOrders
  const kilimallSettlementsRef = useRef(kilimallSettlements); kilimallSettlementsRef.current = kilimallSettlements
  const outsourceJobsRef = useRef(outsourceJobs); outsourceJobsRef.current = outsourceJobs
  const outsourcePaymentsRef = useRef(outsourcePayments); outsourcePaymentsRef.current = outsourcePayments
  const customerCreditsRef = useRef(customerCredits); customerCreditsRef.current = customerCredits
  const quotesRef = useRef(quotes); quotesRef.current = quotes
  const paymentsRef = useRef(payments); paymentsRef.current = payments

  const getProductTrackingMethod = (product: Partial<Product> | null | undefined): TrackingMethod =>
    inferTrackingMethod({
      trackingMethod: product?.trackingMethod,
      category: product?.category,
      requiresSerial: product?.requiresSerial,
      unit: product?.unit,
    })

  const buildInventoryBarcodeForProduct = (productId: string, manufacturerSerial?: string) => {
    const product = prodRef.current.find(item => item.id === productId)
    return buildInventoryBarcode({
      existingBarcodes: serialRef.current.map(item => item.barcode),
      manufacturerSerial,
      productSku: product?.sku,
    })
  }

  const normalizeUnitSkuSeed = (value: string | null | undefined, fallback: string) => {
    const cleaned = String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
    return cleaned || fallback
  }

  const buildSerialUnitSku = (
    product: Product,
    serial: string,
    requestedSku: string | undefined,
    reservedSkus: Set<string>,
  ) => {
    const requested = String(requestedSku ?? '').trim().toUpperCase()
    if (requested && !['AUTO', 'SYSTEM', 'GENERATE'].includes(requested)) return requested

    const productSeed = normalizeUnitSkuSeed(product.sku || product.name, 'SKU')
    const serialSeed = normalizeUnitSkuSeed(serial, 'UNIT')
    const base = `${productSeed}-${serialSeed}`.slice(0, 40)
    let candidate = base
    let suffix = 1
    while (reservedSkus.has(candidate)) {
      candidate = `${base}-${suffix++}`.slice(0, 48)
    }
    return candidate
  }

  const getActiveOutsourceJob = (repairId: string) =>
    outsourceJobsRef.current.find(job => job.repairOrderId === repairId && job.status === 'sent')

  const blockIfOutsourced = (repairId: string, action = 'continue this repair') => {
    const job = getActiveOutsourceJob(repairId)
    if (!job) return false
    showToast(`Cannot ${action} while ${job.ref} is still at ${job.vendorName}. Mark it returned in Outsource first.`, 'error')
    return true
  }

  /** Intake a retained repair device into warehouse via free buy-back or donation-in. */
  // Buy-back / exchange numbers come from the server sequence (BBK/2026/0001),
  // like delivery notes. They used to be counted in each browser, so every
  // buy-back ended up as BBK/0001. The record is saved at once under a
  // temporary number that cannot clash (BBK/2026/L…); the server number then
  // replaces it on the record, its repair and its stock moves.
  /** A rider weekly-pay number: unique at once, the server's RWP/NNNN as soon as it answers. */
  const riderPayRef = (): string => {
    const provisional = allocateDocNumberSync('RWP')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('RWP').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        setRiderWeeklyPays(p => p.map(w => (w.ref === provisional ? { ...w, ref: finalRef } : w)))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /**
   * An expense claim number: unique at once, the server's EXP/NNNN as soon as
   * it answers. It used to come from this browser's own counter, so two
   * browsers issued the same EXP number; the second claim's journal was then
   * taken as already posted and skipped, and the claim could never be paid.
   */
  const expenseRef = (): string => {
    const provisional = allocateDocNumberSync('EXP')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('EXP').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        setExpenses(p => p.map(e => (e.ref === provisional ? { ...e, ref: finalRef } : e)))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /**
   * A customer contract number: unique at once, the server's CTR/NNNN as soon
   * as it answers. It used to come from this browser's own counter — the one
   * deals used too — so two browsers issued the same contract number.
   */
  const contractRef = (): string => {
    const provisional = allocateDocNumberSync('CTR')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('CTR').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        setCustomerContracts(p => p.map(c => (c.ref === provisional ? { ...c, ref: finalRef } : c)))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /** An outsource job number: unique at once, the server's OUT/NNNN as soon as it answers. */
  const outsourceRef = (): string => {
    const provisional = allocateDocNumberSync('OUT')
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef('OUT').then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        const swap = (text?: string) => (text && text.includes(provisional) ? text.split(provisional).join(finalRef) : text)
        setOutsourceJobs(p => p.map(j => (j.ref === provisional ? { ...j, ref: finalRef } : j)))
        setRepairs(p => (p.some(r => JSON.stringify(r.statusHistory ?? []).includes(provisional) || (r.notes ?? '').includes(provisional))
          ? p.map(r => ({
            ...r,
            notes: swap(r.notes) ?? r.notes,
            statusHistory: r.statusHistory?.map(h => ({ ...h, note: swap(h.note) ?? h.note })),
          }))
          : p))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  /** The outsource vendor's contact (Contacts / accounts), matched by name. */
  const outsourceVendorContactId = (vendorId: string, vendorName: string) =>
    contacts.find(c => c.isVendor && c.name.trim().toLowerCase() === vendorName.trim().toLowerCase())?.id ?? vendorId

  /** Bills raised for this vendor's outsource jobs (cancelled ones left out). */
  const outsourceVendorBills = (vendorId: string) => {
    const ids = new Set(outsourceJobsRef.current.filter(j => j.vendorId === vendorId && j.billId).map(j => j.billId!))
    return invRef.current.filter(i => ids.has(i.id) && i.status !== 'cancelled')
  }

  /**
   * Draft vendor bill for an outsource job. It carries the draft placeholder
   * like every other bill, so Finance's posting gives it the official BILL
   * number (it used to take a number from this browser's own counter, which
   * posting kept — duplicates across browsers).
   */
  const createOutsourceBill = (job: OutsourceJob, cost: number): string => {
    const line: InvoiceLine = {
      id: uid(),
      description: `Outsource Service: ${OUTSOURCE_SERVICE_TYPES.find(t => t.value === job.serviceType)?.label ?? job.serviceType} — ${job.deviceDescription}`,
      qty: 1,
      unitPrice: cost,
      taxRate: 0,
      subtotal: cost,
    }
    const vendorContactId = outsourceVendorContactId(job.vendorId, job.vendorName)
    const bill: Invoice = {
      id: uid(),
      ref: draftInvoiceRef('vendor_bill'),
      type: 'vendor_bill',
      status: 'draft',
      partnerId: vendorContactId,
      partnerName: job.vendorName,
      date: now(),
      dueDate: addDays(now(), contactPaymentTermsDays(contacts.find(c => c.id === vendorContactId), systemSettings.purDefaultPaymentTermsDays ?? 30)),
      lines: [line],
      subtotal: cost,
      taxTotal: 0,
      total: cost,
      amountPaid: 0,
      notes: `Outsource job ${job.ref} — ${job.deviceDescription}`,
    }
    invRef.current = [bill, ...invRef.current]
    setInvoices(prev => [bill, ...prev])
    void saveInvoiceToServer(bill, msg => showToast(msg, 'error'))
    showToast(`Draft vendor bill created for ${job.vendorName} — Finance confirms it before payment`, 'success')
    return bill.id
  }

  const tradeInRef = (prefix: 'BBK' | 'EXC'): string => {
    const provisional = allocateDocNumberSync(prefix)
    queueMicrotask(() => {
      void storeCtxRef.current?.allocateDocRef(prefix).then(finalRef => {
        if (!finalRef || finalRef === provisional || finalRef.includes('/L')) return
        const swap = (text?: string) => (text && text.includes(provisional) ? text.split(provisional).join(finalRef) : text)
        if (prefix === 'BBK') setBuyBacks(p => p.map(b => (b.ref === provisional ? { ...b, ref: finalRef } : b)))
        else setClientExchanges(p => p.map(e => (e.ref === provisional ? { ...e, ref: finalRef } : e)))
        setRepairs(p => (p.some(r => r.retainedBuyBackRef === provisional || (r.notes ?? '').includes(provisional))
          ? p.map(r => (r.retainedBuyBackRef === provisional || (r.notes ?? '').includes(provisional)
            ? { ...r, retainedBuyBackRef: r.retainedBuyBackRef === provisional ? finalRef : r.retainedBuyBackRef, notes: swap(r.notes) ?? r.notes }
            : r))
          : p))
        setWarranties(p => (p.some(w => w.cancelledByRef === provisional)
          ? p.map(w => (w.cancelledByRef === provisional ? { ...w, cancelledByRef: finalRef, cancelledReason: swap(w.cancelledReason) } : w))
          : p))
        setStockMoves(p => (p.some(m => m.documentRef === provisional)
          ? p.map(m => (m.documentRef === provisional ? { ...m, documentRef: finalRef, reason: swap(m.reason) ?? m.reason } : m))
          : p))
      }).catch(() => { /* the temporary number stays; it is unique */ })
    })
    return provisional
  }

  // A machine the customer sold back to us (buy-back) or handed in on an
  // exchange is no longer theirs: its warranty ends there. Only warranties
  // already on file are touched (a later resale gets its own new warranty).
  const cancelWarrantiesForTradeIn = (serialIds: string[], docRef: string, reason: string) => {
    const ids = new Set(serialIds.filter(Boolean))
    if (!ids.size) return
    const at = now()
    const ending = warranties.filter(w => ids.has(w.serialId) && w.status !== 'cancelled')
    if (!ending.length) return
    setWarranties(p => p.map(w => (ids.has(w.serialId) && w.status !== 'cancelled'
      ? { ...w, status: 'cancelled' as const, cancelledAt: at, cancelledReason: reason, cancelledByRef: docRef }
      : w)))
    addAuditLog('warranty_cancel', docRef, `Cancelled ${ending.map(w => w.ref).join(', ')} — ${reason}`)
  }

  const convertRetainedDeviceIntoInventory = (args: {
    repair: RepairOrder
    mode: 'buyback' | 'donation'
    notes?: string
    at: string
    byName: string
  }): { ok: true; mode: 'buyback' | 'donation'; id: string; ref: string } | { ok: false; message: string } => {
    const { repair, mode, notes, at, byName } = args
    const product = findRepairCatalogProduct(prodRef.current, repair)
    if (!product) {
      return { ok: false, message: 'Link a catalog product on the repair first' }
    }

    let serialId: string | undefined
    let serialText = ''
    if (product.requiresSerial || repair.serialNumber?.trim()) {
      const matched = matchRepairDeviceSerial(serialRef.current, product.id, repair)
      if ('error' in matched) return { ok: false, message: matched.error }
      serialText = matched.serialText
      if (matched.existing) {
        serialId = matched.existing.id
        if (matched.existing.status !== 'sold' && matched.existing.location !== 'customer') {
          setSerials(p => p.map(s => s.id === matched.existing!.id
            ? { ...s, status: 'sold' as const, location: 'customer' as LocationId, soldDate: s.soldDate || at }
            : s))
        }
      } else {
        const newSerial: SerialNumber = {
          id: uid(),
          serial: serialText,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          location: 'customer',
          status: 'sold',
          receivedDate: at,
          soldDate: at,
          barcode: buildInventoryBarcodeForProduct(product.id, serialText),
        }
        setSerials(p => [...p, newSerial])
        sync('/api/serials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newSerial) })
        serialId = newSerial.id
      }
    }

    if (product.requiresSerial && !serialId) {
      return { ok: false, message: 'Serialized product needs a serial number' }
    }

    const condition = buyBackConditionFromRepair(repair.deviceCondition)
    const serialIds = serialId ? [serialId] : []
    const serialLabels = serialText
      ? [serialText]
      : serialIds.map(id => serialRef.current.find(s => s.id === id)?.serial ?? id)

    if (mode === 'donation') {
      const don: Donation = {
        id: uid(),
        ref: allocateDocNumberSync('DON'),
        type: 'in',
        party: repair.customerName || 'Customer',
        date: at,
        lines: [{
          id: uid(),
          productId: product.id,
          productName: product.name,
          qty: 1,
          serialIds,
          notes: `From retained repair ${repair.ref}`,
        }],
        status: 'confirmed',
        location: 'warehouse',
        notes: `Customer left device with Deed from repair ${repair.ref}${notes ? ` — ${notes}` : ''}`,
        repairId: repair.id,
        repairRef: repair.ref,
        confirmedByName: byName,
        confirmedDate: at,
      }
      setDonations(p => [don, ...p]); numberDonations([don.id])
      if (serialId) {
        setSerials(p => p.map(s => s.id === serialId
          ? {
              ...s,
              status: condition === 'poor' ? 'refurbishment' as const : 'available' as const,
              location: 'warehouse' as LocationId,
              soldDate: undefined,
              saleOrderId: undefined,
              repairId: undefined,
            }
          : s))
      } else {
        setBulkStock(prev => upsertBulkStock(prev, product.id, 'warehouse', 1))
      }
      setProducts(p => p.map(x => x.id === product.id ? { ...x, stockQty: x.stockQty + 1 } : x))
      addMove(product.id, product.name, 1, 'in', `Donation in ${don.ref} (retained repair ${repair.ref})`, don.ref, 'customer', 'warehouse', serialLabels)
      return { ok: true, mode: 'donation', id: don.id, ref: don.ref }
    }

    const bb: BuyBack = {
      id: uid(),
      ref: tradeInRef('BBK'),
      customerId: repair.customerId,
      customerName: repair.customerName,
      repairId: repair.id,
      repairRef: repair.ref,
      status: 'stocked',
      date: at,
      lines: [{
        id: uid(),
        productId: product.id,
        productName: product.name,
        qty: 1,
        serialIds,
        condition,
        unitPrice: 0,
        notes: `From retained repair ${repair.ref}`,
      }],
      total: 0,
      destinationLocation: 'warehouse',
      notes: `Customer left device with Deed from repair ${repair.ref}${notes ? ` — ${notes}` : ''}`,
      approvedByName: byName,
      approvedDate: at,
      paidDate: at,
      paymentMethod: 'cash',
      stockedDate: at,
      stockedByName: byName,
    }
    setBuyBacks(p => [bb, ...p])
    if (serialId) {
      setSerials(p => p.map(s => s.id === serialId
        ? {
            ...s,
            status: condition === 'poor' ? 'refurbishment' as const : 'available' as const,
            location: 'warehouse' as LocationId,
            soldDate: undefined,
            saleOrderId: undefined,
            repairId: undefined,
          }
        : s))
    } else {
      setBulkStock(prev => upsertBulkStock(prev, product.id, 'warehouse', 1))
    }
    setProducts(p => p.map(x => x.id === product.id ? { ...x, stockQty: x.stockQty + 1 } : x))
    addMove(product.id, product.name, 1, 'in', `Buy-back ${bb.ref} (retained repair ${repair.ref})`, bb.ref, 'customer', 'warehouse', serialLabels)
      cancelWarrantiesForTradeIn(serialIds, bb.ref, `Bought back from ${repair.customerName} (${bb.ref}, retained repair ${repair.ref})`)
    return { ok: true, mode: 'buyback', id: bb.id, ref: bb.ref }
  }

  const markRepairLockedForOutsource = (repair: RepairOrder, job: OutsourceJob): RepairOrder => ({
    ...repair,
    status: 'in_repair',
    repairStartDate: repair.repairStartDate ?? now(),
    statusHistory: [
      ...(repair.statusHistory ?? []),
      {
        status: 'in_repair',
        date: now(),
        note: `Locked in repair while outsourced to ${job.vendorName} via ${job.ref}`,
        by: job.sentByName,
      },
    ],
  })

  // Keep the cached product quantity aligned with the location-aware stock records.
  // Only from complete, current copies: a page that has not downloaded the
  // serials or stock levels (the dashboard, repairs) computed quantities from
  // part of the stock, and that recalculated list — hundreds of products —
  // was saved to the server on every load, overwriting good quantities and
  // making every other open session download the catalog again.
  useEffect(() => {
    if (!downloadedThisSession(['deed_products', 'deed_serials', 'deed_bulkStock'])) return
    setProducts(prev => {
      let changed = false
      const next = prev.map(product => {
        const locs = calcStockByLocation(product, serials, bulkStock, product.id, true)
        const stockQty = locs.warehouse + locs.shop + locs.repair_unit
        if (product.stockQty === stockQty) return product
        changed = true
        return { ...product, stockQty }
      })
      return changed ? next : prev
    })
  }, [serials, bulkStock])

  // Customer quote decisions write deed_repairs_v2. The store SSE invalidates
  // that key; a 10s per-job /api/portal/repair/{ref} poll was reconstructing
  // invoices + photos for every awaiting-approval row on every screen.

  // Poll server for new notifications — sticky-merge so read never flips unread
  useEffect(() => {
    if (!currentUserId) return
    const checkNotifications = async () => {
      try {
        const res = await fetch(`/api/notifications?userId=${currentUserId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data?.notifications && Array.isArray(data.notifications)) {
          setNotifications(prev => mergeNotificationsSticky(prev, data.notifications as AppNotification[]))
        }
      } catch { /* silent */ }
    }
    const id = setInterval(checkNotifications, 60_000) // SSE handles real-time; this is a fallback
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  
  const addMove = (productId: string, productName: string, qty: number, type: StockMove['type'], reason: string, docRef: string, fromLoc?: LocationId, toLoc?: LocationId, serNums: string[] = []) => {
    const actor = currentUser()
    const move: StockMove = { id: uid(), type, productId, productName, qty, reason, fromLocation: fromLoc, toLocation: toLoc, serialNumbers: serNums, date: now(), userId: actor?.id ?? 'system', documentRef: docRef }
    setStockMoves(p => [move, ...p])
    sync('/api/stock-moves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(move) })
  }

  const currentUser = () => currentUserId ? users.find(u => u.id === currentUserId) ?? null : null

  // ── Refurbishment parts and warehouse stock ─────────────────────────────────
  /** Good stock of a part in the warehouse (not With Issues, not in the repair unit). */
  const refurbWarehouseQty = (productId: string) => {
    const prod = prodRef.current.find(p => p.id === productId)
    return calcStockByLocation(prod, serialRef.current, bulkStock, productId).warehouse
  }
  /** Take a refurbishment part out of warehouse stock. False (with a message) when there is not enough there. */
  const takeRefurbPartFromWarehouse = (job: RefurbishmentJob, part: RefurbPart, byName: string): boolean => {
    if (!part.productId) return false
    const prod = prodRef.current.find(p => p.id === part.productId)
    const available = refurbWarehouseQty(part.productId)
    if (available < part.qty) {
      showToast(`Not enough ${prod?.name ?? part.partName} in the warehouse: ${available} there, ${part.qty} needed. Order it or receive the PO first.`, 'error')
      return false
    }
    setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: Math.max(0, x.stockQty - part.qty) } : x))
    setBulkStock(prev => upsertBulkStock(prev, part.productId!, 'warehouse', -part.qty))
    addMove(part.productId, part.partName, part.qty, 'out', `Refurb ${job.ref} — part taken by ${byName}`, job.ref, 'warehouse', 'repair_unit', [])
    return true
  }
  /**
   * A parts-queue request wherever it is kept: a repair's procurement request,
   * or a refurbishment part (one request per part). `write` applies the
   * desk's change back to that record.
   */
  type QueueRequest = {
    ref: string
    technicianId?: string
    request: PartsRequest
    write: (fn: (req: PartsRequest) => PartsRequest) => void
  } & ({ kind: 'refurb'; job: RefurbishmentJob; part: RefurbPart } | { kind: 'repair'; repair: RepairOrder })
  const partsQueueRequest = (kind: PartsRequestKind, ownerId: string, requestId: string): QueueRequest | null => {
    if (kind === 'refurb') {
      const job = refurbishmentJobs.find(j => j.id === ownerId)
      const part = job?.partsNeeded.find(pt => pt.id === requestId)
      const request = job && part ? refurbPartRequest(job, part) : null
      if (!job || !part || !request) return null
      return {
        kind, job, part, request, ref: job.ref, technicianId: job.assignedTechnicianId,
        write: fn => setRefurbishmentJobs(prev => prev.map(j => j.id !== ownerId ? j : {
          ...j,
          partsNeeded: j.partsNeeded.map(pt => {
            if (pt.id !== requestId) return pt
            const req = refurbPartRequest(j, pt)
            return req ? refurbPartAfterRequest(pt, fn(req)) : pt
          }),
        })),
      }
    }
    const repair = repairsRef.current.find(r => r.id === ownerId)
    const request = repair?.procurementRequests?.find(r => r.id === requestId)
    if (!repair || !request) return null
    return {
      kind, repair, request: request as PartsRequest, ref: repair.ref, technicianId: repair.assignedTechnicianId,
      write: fn => setRepairs(prev => prev.map(r => r.id !== ownerId ? r : {
        ...r,
        procurementRequests: (r.procurementRequests ?? []).map(req => req.id === requestId ? fn(req as PartsRequest) as typeof req : req),
      })),
    }
  }
  /**
   * Trade-in machines that need work go straight to Refurbishment with a job:
   * tagged ones (serial unknown) always, and ones taken in as "poor". They
   * used to be marked refurbishment with no job, and no screen showed them.
   */
  /**
   * Refurbishment job numbers come from the server (REF/NNNN). They used to be
   * counted in each browser, so every browser started again at REF/0001. A
   * new job gets a temporary, clash-free number and its real one a moment
   * later.
   */
  /**
   * Give records their real server numbers, one at a time (PREFIX/NNNN).
   * Records numbered in the browser used to repeat; see lib/doc-number-repair.ts.
   */
  const numberRefurbJobs = (ids: string[]) =>
    assignServerNumbers('refurbishment', 'REF', ids, (id, ref) => setRefurbishmentJobs(p => p.map(j => j.id === id ? { ...j, ref } : j)))
  /** Jobs whose number another job already has, or still a temporary one. */
  const refurbJobsNeedingNumbers = (jobs: RefurbishmentJob[]): string[] =>
    recordsNeedingNumbers(jobs, { dateOf: j => j.intakeDate, isFinal: ref => /^REF\/\d+$/.test(ref) })

  /**
   * A stock adjustment's real number. A repeated old number is kept as
   * `formerRef` (its journals and stock moves carry it). A stand-in number is
   * also replaced where a parts request recorded it.
   */
  const applyAdjustmentNumber = (id: string, ref: string) => {
    const old = adjRef.current.find(a => a.id === id)?.ref
    setStockAdjustments(p => p.map(a => a.id === id ? withServerRef(a, ref) : a))
    if (!old || !isProvisionalDocRef(old)) return
    const swap = (refs?: string[]) => refs?.map(r => (r === old ? ref : r))
    setRepairs(p => p.some(r => r.procurementRequests?.some(q => q.adjustmentRefs?.includes(old)))
      ? p.map(r => ({ ...r, procurementRequests: r.procurementRequests?.map(q => q.adjustmentRefs?.includes(old) ? { ...q, adjustmentRefs: swap(q.adjustmentRefs) } : q) }))
      : p)
    setRefurbishmentJobs(p => p.some(j => j.partsNeeded.some(pt => pt.adjustmentRefs?.includes(old)))
      ? p.map(j => ({ ...j, partsNeeded: j.partsNeeded.map(pt => pt.adjustmentRefs?.includes(old) ? { ...pt, adjustmentRefs: swap(pt.adjustmentRefs) } : pt) }))
      : p)
  }
  const numberAdjustments = (ids: string[]) => assignServerNumbers('adjustment', 'ADJ', ids, applyAdjustmentNumber)

  // Transfers, customer returns, donations and refund payments: the same.
  const applyTransferNumber = (id: string, ref: string) => setStockTransfers(p => p.map(t => t.id === id ? withServerRef(t, ref) : t))
  const applyDonationNumber = (id: string, ref: string) => setDonations(p => p.map(d => d.id === id ? withServerRef(d, ref) : d))
  const applyRefundPaymentNumber = (id: string, ref: string) => setRefundPayments(p => p.map(r => r.id === id ? withServerRef(r, ref) : r))
  /** A return's number also shows on its refund payments. */
  const applyReturnNumber = (id: string, ref: string) => {
    setReturnOrders(p => p.map(r => r.id === id ? withServerRef(r, ref) : r))
    setRefundPayments(p => p.some(x => x.rmaId === id) ? p.map(x => x.rmaId === id ? { ...x, rmaRef: ref } : x) : p)
  }
  const numberTransfers = (ids: string[]) => assignServerNumbers('transfer', 'TR', ids, applyTransferNumber)
  const numberReturns = (ids: string[]) => assignServerNumbers('return_order', 'RMA', ids, applyReturnNumber)
  const numberDonations = (ids: string[]) => assignServerNumbers('donation', 'DON', ids, applyDonationNumber)
  const applyPosSessionNumber = (id: string, ref: string) => setPosSessions(p => p.map(x => x.id === id ? withServerRef(x, ref) : x))
  const numberPosSessions = (ids: string[]) => assignServerNumbers('pos_session', 'POSSESS', ids, applyPosSessionNumber)
  const numberRefundPayments = (ids: string[]) => assignServerNumbers('refund_payment', 'RFD', ids, applyRefundPaymentNumber)

  /**
   * One-time repair, per collection, once its data has loaded on this page:
   * repeated or stand-in numbers get server numbers (the oldest keeps its
   * own). Refund payments are money records: their repeats are only listed
   * (Accounting › Refunds), never renumbered here.
   */
  const pagePath = typeof window !== 'undefined' ? (window.location.pathname || '/') : '/'
  const pageDataReady = useRouteDataReady(pagePath)
  const docNumbersRepaired = useRef(new Set<string>())
  useEffect(() => {
    const user = currentUser()
    if (!pageDataReady || !user) return
    const loaded = new Set(appStateKeysForRoute(pagePath))
    const series: Array<{ key: string; records: Array<{ id: string; ref: string }>; dateOf: (r: never) => string; renumber: (ids: string[]) => void }> = [
      { key: 'deed_stockTransfers', records: stockTransfers, dateOf: (t: StockTransfer) => t.date, renumber: numberTransfers },
      { key: 'deed_returnOrders', records: returnOrders, dateOf: (r: ReturnOrder) => r.requestDate, renumber: numberReturns },
      { key: 'deed_donations', records: donations, dateOf: (d: Donation) => d.date, renumber: numberDonations },
    ]
    for (const s of series) {
      if (!loaded.has(s.key) || !s.records.length || docNumbersRepaired.current.has(s.key) || !canWriteStoreKey(user, s.key)) continue
      docNumbersRepaired.current.add(s.key)
      s.renumber(recordsNeedingNumbers(s.records, { dateOf: s.dateOf as (r: { id: string; ref: string }) => string }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageDataReady, pagePath, currentUserId, stockTransfers.length, returnOrders.length, donations.length])
  const openTradeInRefurbJobs = (units: Array<{ serialId: string; issue: string; cost?: number; sourceRef: string }>) => {
    const open = new Set(refurbishmentJobs.filter(j => j.status !== 'transferred' && j.status !== 'written_off').map(j => j.serialId))
    const jobs: RefurbishmentJob[] = []
    for (const u of units) {
      const ser = serialRef.current.find(s => s.id === u.serialId)
      if (!ser || open.has(ser.id)) continue
      open.add(ser.id)
      const tagged = awaitingIdentification(ser)
      const prod = prodRef.current.find(p => p.id === ser.productId)
      jobs.push({
        id: uid(), ref: allocateDocNumberSync('REF'),
        status: 'queued',
        serialId: ser.id, serialNumber: ser.serial,
        productId: ser.productId, productName: ser.productName,
        specs: ser.specs || (tagged ? '' : prod?.description),
        specsAtIntake: ser.specs || (tagged ? '' : prod?.description || ''),
        intakeDate: new Date().toISOString(),
        intakeIssueDescription: u.issue,
        partsNeeded: [],
        intakeSource: 'trade_in',
        intakeSourceRef: u.sourceRef,
        ...(u.cost != null ? { intakeCost: u.cost } : {}),
        ...(tagged ? { identityPending: true, intakeTag: ser.intakeTag || ser.serial } : {}),
      })
    }
    if (!jobs.length) return 0
    const ids = new Set(jobs.map(j => j.serialId))
    const costs = new Map(units.map(u => [u.serialId, u.cost]))
    setSerials(p => p.map(s => !ids.has(s.id) ? s : { ...s, location: 'repair_unit', status: 'refurbishment', ...(costs.get(s.id) != null ? { intakeCost: costs.get(s.id) } : {}) }))
    setRefurbishmentJobs(p => [...p, ...jobs])
    numberRefurbJobs(jobs.map(j => j.id))
    return jobs.length
  }

  /** Put a part that was taken for a job and never fitted back into the warehouse. */
  const returnRefurbPartToWarehouse = (job: RefurbishmentJob, part: RefurbPart) => {
    if (!part.productId) return
    setProducts(p => p.map(x => x.id === part.productId ? { ...x, stockQty: x.stockQty + part.qty } : x))
    setBulkStock(prev => upsertBulkStock(prev, part.productId!, 'warehouse', part.qty))
    addMove(part.productId, part.partName, part.qty, 'in', `Refurb ${job.ref} — unused part returned`, job.ref, 'repair_unit', 'warehouse', [])
  }

  const addAuditLog = (action: string, documentRef: string, details: string, opts?: { sessionOnly?: boolean }) => {
    const actor = currentUser()?.username || 'system'
    const log: AuditLog = { id: uid(), date: now(), user: actor, action, documentRef, details }
    setAuditLogs(p => [log, ...p].slice(0, SESSION_AUDIT_LOG_LIMIT))
    if (opts?.sessionOnly) return
    // P0-SEC-002: persist via server-authored endpoint (client store writes to
    // deed_auditLogs are ignored).
    void fetch('/api/audit/commercial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, documentRef, details }),
    }).catch(() => { /* offline — local mirror remains until sync */ })
  }

  /**
   * Push customer identity onto linked quotes, sale orders (proformas), and invoices.
   * Used when a contact or document customer fields change so PDF reprints stay current.
   */
  const syncCustomerIdentityToDocuments = (opts: {
    contactId?: string
    saleOrderId?: string
    repairId?: string
    invoiceId?: string
    identity: {
      name: string
      email?: string
      phone?: string
      address?: string
      customerId?: string
    }
  }) => {
    const { contactId, saleOrderId, repairId, invoiceId, identity } = opts
    if (!identity.name?.trim()) return

    const quoteNext = quotesRef.current.map(q => {
      const repair = repairId ? repairsRef.current.find(r => r.id === repairId) : undefined
      const linked =
        (contactId && quoteMatchesCustomer(q, contactId))
        || (repairId && (q.repairId === repairId || (repair?.salesQuoteId && q.id === repair.salesQuoteId)))
      if (!linked || !shouldSyncQuoteCustomer(q.status)) return q
      const patched = applyCustomerToQuote(q, identity)
      if (
        patched.companyName === q.companyName
        && patched.contactPersonEmail === q.contactPersonEmail
        && patched.contactPersonPhone === q.contactPersonPhone
      ) return q
      sync(`/api/quotes/${q.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patched) })
      return patched
    })
    if (quoteNext.some((q, i) => q !== quotesRef.current[i])) {
      setQuotes(quoteNext)
      quotesRef.current = quoteNext
    }

    const soNext = soRef.current.map(so => {
      const repair = repairId ? repairsRef.current.find(r => r.id === repairId) : undefined
      const linked =
        (contactId && so.customerId === contactId)
        || (saleOrderId && so.id === saleOrderId)
        || (repair && (so.id === repair.saleOrderId || so.quoteId === repair.salesQuoteId))
      if (!linked || !shouldSyncSaleOrderCustomer(so.status)) return so
      const patched = applyCustomerToSaleOrder(so, {
        ...identity,
        customerId: identity.customerId || contactId || so.customerId,
      })
      if (
        patched.customerName === so.customerName
        && patched.customerId === so.customerId
        && patched.invoiceAddress === so.invoiceAddress
      ) return so
      sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patched) })
      return patched
    })
    if (soNext.some((s, i) => s !== soRef.current[i])) {
      setSaleOrders(soNext)
      soRef.current = soNext
    }

    const invNext = invRef.current.map(inv => {
      if (inv.type === 'vendor_bill') return inv
      const repair = repairId ? repairsRef.current.find(r => r.id === repairId) : undefined
      const linked =
        (contactId && inv.partnerId === contactId)
        || (saleOrderId && inv.saleOrderId === saleOrderId)
        || (repairId && (inv.repairId === repairId || (repair?.invoiceId && inv.id === repair.invoiceId) || (repair?.saleOrderId && inv.saleOrderId === repair.saleOrderId)))
        || (invoiceId && inv.id === invoiceId)
      if (!linked || !shouldSyncInvoiceCustomer(inv.status)) return inv
      const patched = applyCustomerToInvoice(inv, {
        ...identity,
        customerId: identity.customerId || contactId || inv.partnerId,
      })
      if (
        patched.partnerName === inv.partnerName
        && patched.partnerId === inv.partnerId
        && patched.invoiceAddress === inv.invoiceAddress
      ) return inv
      sync(`/api/invoices/${inv.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patched) })
      return patched
    })
    if (invNext.some((inv, i) => inv !== invRef.current[i])) {
      setInvoices(invNext)
      invRef.current = invNext
    }

    if (contactId) {
      const repairNext = repairsRef.current.map(r => {
        if (repairId && r.id === repairId) return r // already updated by caller
        if (r.customerId !== contactId) return r
        const nextName = identity.name
        const nextPhone = identity.phone !== undefined ? identity.phone : r.customerPhone
        const nextEmail = identity.email !== undefined ? (identity.email || undefined) : r.customerEmail
        if (
          r.customerName === nextName
          && r.customerPhone === nextPhone
          && r.customerEmail === nextEmail
        ) return r
        const patched = {
          ...r,
          customerName: nextName,
          customerPhone: nextPhone || r.customerPhone,
          customerEmail: nextEmail,
        }
        setTimeout(() => syncRepairToPortal(patched), 0)
        return patched
      })
      if (repairNext.some((r, i) => r !== repairsRef.current[i])) {
        setRepairs(repairNext)
        repairsRef.current = repairNext
      }
    }
  }

  // Post an invoice's GL journal exactly once. Every path that marks an invoice
  // `posted` (from a sale order, delivery, repair-quote conversion, or the manual
  // postInvoice action) routes through here so the AR/revenue subledger and the
  // General Ledger never drift apart. The dedup guard keys on the journal ref.
  const postInvoiceJournalOnce = (inv: Invoice) => {
    const po = inv.purchaseOrderId ? poRef.current.find(p => p.id === inv.purchaseOrderId) : null
    const journal = buildInvoicePostingJournal(
      inv,
      (productId) => prodRef.current.find(p => p.id === productId),
      accountRef.current.map(a => ({ code: a.code, name: a.name })),
      {
        perpetual: systemSettings.invAutomatedValuation !== false,
        poLines: po?.lines?.map(l => ({ productId: l.productId, unitPrice: l.unitPrice })),
      },
    )
    setJournalEntries(p => (p.some(j => j.ref === journal.ref) ? p : [journal, ...p]))
    addAuditLog('post_invoice', inv.ref, `${inv.type === 'vendor_bill' ? 'Bill' : 'Invoice'} posted to journal ${journal.ref}`)
  }

  const storeCtxRef = useRef<AppState>(null as unknown as AppState)
  // Stable per-area action bundles; each forwards to the live provider value.
  const { inventoryActions, salesActions, repairActions, shellActions, crmActions, financeActions, hrActions, deliveryActions, commerceActions, afterSalesActions, operationsActions } = useViewActions(storeCtxRef)

  // Wire cross-cutting deps (currentUser/users/showToast/addAuditLog/pushNotif/
  // workflowApprovals) into useHrStore so its actions can use them without this
  // file's Context — see hooks/useHrStore.ts and the store-refactor pilot plan.
  useEffect(() => {
    useHrDomainStore.getState().setHrContext({
      currentUser, users, showToast, addAuditLog, pushNotif: pushNotif as (...args: unknown[]) => void,
      workflowApprovals, setWorkflowApprovals,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, users, workflowApprovals])

// Server-store pushes (SSE / cross-tab sync) can land raw Prisma rows in the
// opportunities state; normalize at the exposure point so every consumer —
// especially the CRM pipeline's owner filters — always sees the client shape.
const normalizedOpportunities = useMemo(
  () => normalizeOpportunitiesForClient(opportunities) as Opportunity[],
  [opportunities],
)

// Sale orders from older localStorage snapshots or store pushes may carry
// legacy statuses ('confirmed', 'delivered', 'pending_approval', …); expose
// them normalized onto the Odoo vocabulary so the UI and workflow guards
// always see quotation | quotation_sent | sale | cancelled.
const normalizedSaleOrders = useMemo(
  () => normalizeSaleOrdersForClient(saleOrders) as SaleOrder[],
  [saleOrders],
)

const pushPpeJournal = (draft: PpeJournalDraft | null): string | undefined => {
  if (!draft || draft.lines.length === 0) return undefined
  if (Math.abs(draft.totalDebit - draft.totalCredit) > 0.05) return undefined
  const journal = journalFromPpeDraft(draft)
  setJournalEntries(prev => (prev.some(j => j.ref === journal.ref) ? prev : [journal, ...prev]))
  // Capitalisation, depreciation and disposal had no server endpoint at all,
  // so the ledger only ever saw them if the blob mirror happened to replay it.
  // Posting unconditionally is safe: the route dedupes on ref and returns the
  // existing entry, which is also why the local guard above is not consulted —
  // a setState updater has not run yet at this point.
  postSystemJournal('fixed_asset', journal, message => showToast(message, 'error'))
  return journal.ref
}

const capitaliseCompanyAsset = (asset: CompanyAsset): CompanyAsset => {
  const kind = shouldPostCapitaliseJournal(asset)
  if (!kind) return asset
  const date = (asset.acquiredDate || new Date().toISOString()).slice(0, 10)
  const draft = kind === 'inventory'
    ? buildCapitaliseFromInventoryJournal(asset, date)
    : buildCapitaliseFromApJournal(asset, date)
  const ref = pushPpeJournal(draft)
  return ref ? { ...asset, capitaliseJournalRef: ref } : asset
}

const setSerialCapitalised = (serialId: string | undefined, restore = false) => {
  if (!serialId) return
  setSerials(prev => prev.map(s => s.id !== serialId ? s : {
    ...s,
    status: restore ? 'available' : 'capitalised',
  }))
}

const storeDeps = {
  get activeModule() { return activeModule },
  get afterSalesActions() { return afterSalesActions },
  get auditLogs() { return auditLogs },
  get children() { return children },
  get commerceActions() { return commerceActions },
  get contracts() { return contracts },
  get crmActions() { return crmActions },
  get customerCredits() { return customerCredits },
  get deliveryActions() { return deliveryActions },
  get employeeAssetAssignments() { return employeeAssetAssignments },
  get financeActions() { return financeActions },
  get hrActions() { return hrActions },
  get hrPerfTargets() { return hrPerfTargets },
  get hrSops() { return hrSops },
  get inventoryActions() { return inventoryActions },
  get kilimallDispatches() { return kilimallDispatches },
  get kilimallOrders() { return kilimallOrders },
  get kilimallSettlements() { return kilimallSettlements },
  get normalizedOpportunities() { return normalizedOpportunities },
  get normalizedSaleOrders() { return normalizedSaleOrders },
  get notifications() { return notifications },
  get openingStockLocked() { return openingStockLocked },
  get operationsActions() { return operationsActions },
  get opportunities() { return opportunities },
  get opportunityActivities() { return opportunityActivities },
  get outboundReleases() { return outboundReleases },
  get outsourceJobs() { return outsourceJobs },
  get outsourcePayments() { return outsourcePayments },
  get outsourceVendors() { return outsourceVendors },
  get payrollRuns() { return payrollRuns },
  get payslips() { return payslips },
  get productPriceHistory() { return productPriceHistory },
  get profileImages() { return profileImages },
  get purchaseReturns() { return purchaseReturns },
  get refSops() { return refSops },
  get refreshProductCatalog() { return refreshProductCatalog },
  get refundPayments() { return refundPayments },
  get repairActions() { return repairActions },
  get salaryAdvances() { return salaryAdvances },
  get salesActions() { return salesActions },
  get serials() { return serials },
  get setHrPerfTargets() { return setHrPerfTargets },
  get setHrSops() { return setHrSops },
  get setSopDocuments() { return setSopDocuments },
  get shellActions() { return shellActions },
  get sidebarOpen() { return sidebarOpen },
  get sopActuals() { return sopActuals },
  get sopDocuments() { return sopDocuments },
  get sops() { return sops },
  get toast() { return toast },
  get workflowApprovals() { return workflowApprovals },
  get bankRecons() { return bankRecons },
  get bankStatementLines() { return bankStatementLines },
  get capitaliseCompanyAsset() { return capitaliseCompanyAsset },
  get companyAssets() { return companyAssets },
  get dbApprovalRules() { return dbApprovalRules },
  get deposits() { return deposits },
  get documentPaymentDetails() { return documentPaymentDetails },
  get expenseRef() { return expenseRef },
  get expenses() { return expenses },
  get isDraftInvoiceRef() { return isDraftInvoiceRef },
  get payments() { return payments },
  get pushPpeJournal() { return pushPpeJournal },
  get saveAccountToServer() { return saveAccountToServer },
  get setAccounts() { return setAccounts },
  get setBankAccountsState() { return setBankAccountsState },
  get setBankRecons() { return setBankRecons },
  get setBankStatementLines() { return setBankStatementLines },
  get setCompanyAssets() { return setCompanyAssets },
  get setDeposits() { return setDeposits },
  get setDocumentPaymentDetailsState() { return setDocumentPaymentDetailsState },
  get setExpenses() { return setExpenses },
  get setPayments() { return setPayments },
  get setSerialCapitalised() { return setSerialCapitalised },
  get applyLocalDraftSaleOrder() { return applyLocalDraftSaleOrder },
  get applySaleOrderPersistResult() { return applySaleOrderPersistResult },
  get bankAccounts() { return bankAccounts },
  get calcSO() { return calcSO },
  get companies() { return companies },
  get confirmingSaleOrderIds() { return confirmingSaleOrderIds },
  get contactPersons() { return contactPersons },
  get contractRef() { return contractRef },
  get customerContracts() { return customerContracts },
  get customerCreditsRef() { return customerCreditsRef },
  get fetchNextKilimallRef() { return fetchNextKilimallRef },
  get kilimallOrdersRef() { return kilimallOrdersRef },
  get kilimallSettlementsRef() { return kilimallSettlementsRef },
  get numberPosSessions() { return numberPosSessions },
  get patchSaleOrderPersist() { return patchSaleOrderPersist },
  get posOrders() { return posOrders },
  get posPendingRefs() { return posPendingRefs },
  get posSessionId() { return posSessionId },
  get posSessionOpen() { return posSessionOpen },
  get posSessionOpeningCash() { return posSessionOpeningCash },
  get posSessions() { return posSessions },
  get requestWarrantySync() { return requestWarrantySync },
  get setApprovalRequests() { return setApprovalRequests },
  get setCompanies() { return setCompanies },
  get setCustomerContracts() { return setCustomerContracts },
  get setKilimallDispatches() { return setKilimallDispatches },
  get setKilimallOrders() { return setKilimallOrders },
  get setKilimallSettlements() { return setKilimallSettlements },
  get setOpportunities() { return setOpportunities },
  get setOpportunityActivities() { return setOpportunityActivities },
  get setPosOrders() { return setPosOrders },
  get setPosSessionId() { return setPosSessionId },
  get setPosSessionOpen() { return setPosSessionOpen },
  get setPosSessionOpeningCash() { return setPosSessionOpeningCash },
  get setPosSessions() { return setPosSessions },
  get adjRef() { return adjRef },
  get applyAdjustmentNumber() { return applyAdjustmentNumber },
  get applyTransferNumber() { return applyTransferNumber },
  get approvalRequests() { return approvalRequests },
  get buildSerialUnitSku() { return buildSerialUnitSku },
  get findProductIdentityDuplicate() { return findProductIdentityDuplicate },
  get getProductTrackingMethod() { return getProductTrackingMethod },
  get holdovers() { return holdovers },
  get numberAdjustments() { return numberAdjustments },
  get numberTransfers() { return numberTransfers },
  get openingStockPosted() { return openingStockPosted },
  get productCreateLockKey() { return productCreateLockKey },
  get productCreateLocksRef() { return productCreateLocksRef },
  get products() { return products },
  get purchaseOrders() { return purchaseOrders },
  get receipts() { return receipts },
  get refurbJobsNeedingNumbers() { return refurbJobsNeedingNumbers },
  get refurbWarehouseQty() { return refurbWarehouseQty },
  get refurbishmentJobs() { return refurbishmentJobs },
  get returnRefurbPartToWarehouse() { return returnRefurbPartToWarehouse },
  get saveHoldoverToServer() { return saveHoldoverToServer },
  get setHoldovers() { return setHoldovers },
  get setOpeningStockPosted() { return setOpeningStockPosted },
  get setProductPriceHistory() { return setProductPriceHistory },
  get setStockAdjustments() { return setStockAdjustments },
  get setStockMoves() { return setStockMoves },
  get setStockReservations() { return setStockReservations },
  get setStockTransfers() { return setStockTransfers },
  get stockAdjustments() { return stockAdjustments },
  get stockMoves() { return stockMoves },
  get stockTransfers() { return stockTransfers },
  get takeRefurbPartFromWarehouse() { return takeRefurbPartFromWarehouse },
  get REPAIR_TERMINAL_STATUSES() { return REPAIR_TERMINAL_STATUSES },
  get blockIfOutsourced() { return blockIfOutsourced },
  get convertRetainedDeviceIntoInventory() { return convertRetainedDeviceIntoInventory },
  get createOutsourceBill() { return createOutsourceBill },
  get getActiveOutsourceJob() { return getActiveOutsourceJob },
  get markRepairLockedForOutsource() { return markRepairLockedForOutsource },
  get outsourceJobsRef() { return outsourceJobsRef },
  get outsourceRef() { return outsourceRef },
  get outsourceVendorBills() { return outsourceVendorBills },
  get partsQueueRequest() { return partsQueueRequest },
  get quotes() { return quotes },
  get repairInvoiceInFlight() { return repairInvoiceInFlight },
  get setContacts() { return setContacts },
  get setOutsourceJobs() { return setOutsourceJobs },
  get setOutsourcePayments() { return setOutsourcePayments },
  get setOutsourceVendors() { return setOutsourceVendors },
  get setQuotes() { return setQuotes },
  get syncCustomerIdentityToDocuments() { return syncCustomerIdentityToDocuments },
  get users() { return users },
  get warRef() { return warRef },
  get setActiveModule() { return setActiveModule },
  get setCompanySettings() { return setCompanySettings },
  get setCurrentUserId() { return setCurrentUserId },
  get setNotifications() { return setNotifications },
  get setProfileImages() { return setProfileImages },
  get setSidebarOpen() { return setSidebarOpen },
  get setSystemSettings() { return setSystemSettings },
  get setUsers() { return setUsers },
  get setRefSops() { return setRefSops },
  get setSopActuals() { return setSopActuals },
  get setSops() { return setSops },
  get assetRef() { return assetRef },
  get empRef() { return empRef },
  get journalEntries() { return journalEntries },
  get payrollRef() { return payrollRef },
  get repairsRef() { return repairsRef },
  get salaryAdvancesRef() { return salaryAdvancesRef },
  get setEmployeeAssetAssignments() { return setEmployeeAssetAssignments },
  get setPayrollRuns() { return setPayrollRuns },
  get setPayslips() { return setPayslips },
  get setSalaryAdvances() { return setSalaryAdvances },
  get setWorkflowApprovals() { return setWorkflowApprovals },
  get accountRef() { return accountRef },
  get calcPO() { return calcPO },
  get confirmingPoRef() { return confirmingPoRef },
  get currentUserId() { return currentUserId },
  get notifyUsers() { return notifyUsers },
  get numberRefurbJobs() { return numberRefurbJobs },
  get poRef() { return poRef },
  get purchaseReturnsRef() { return purchaseReturnsRef },
  get recRef() { return recRef },
  get setPurchaseOrders() { return setPurchaseOrders },
  get setPurchaseReturns() { return setPurchaseReturns },
  get setReceipts() { return setReceipts },
  get setRefurbishmentJobs() { return setRefurbishmentJobs },
  get systemSettings() { return systemSettings },
  get accounts() { return accounts },
  get addDays() { return addDays },
  get companySettings() { return companySettings },
  get contacts() { return contacts },
  get deliveries() { return deliveries },
  get deliveryJobs() { return deliveryJobs },
  get fetchNextDeliveryRef() { return fetchNextDeliveryRef },
  get invoices() { return invoices },
  get postInvoiceJournalOnce() { return postInvoiceJournalOnce },
  get repairs() { return repairs },
  get riderPayRef() { return riderPayRef },
  get riderWeeklyPays() { return riderWeeklyPays },
  get riders() { return riders },
  get saleOrders() { return saleOrders },
  get setDeliveryJobs() { return setDeliveryJobs },
  get setRiderWeeklyPays() { return setRiderWeeklyPays },
  get setRiders() { return setRiders },
  get stockReservations() { return stockReservations },
  get syncRepairToPortal() { return syncRepairToPortal },
  get LOCATIONS() { return LOCATIONS },
  get addAuditLog() { return addAuditLog },
  get addMove() { return addMove },
  get applyReturnNumber() { return applyReturnNumber },
  get buildInventoryBarcodeForProduct() { return buildInventoryBarcodeForProduct },
  get bulkStock() { return bulkStock },
  get buyBacks() { return buyBacks },
  get calcStockByLocation() { return calcStockByLocation },
  get cancelWarrantiesForTradeIn() { return cancelWarrantiesForTradeIn },
  get clientExchanges() { return clientExchanges },
  get currentUser() { return currentUser },
  get delRef() { return delRef },
  get donations() { return donations },
  get draftInvoiceRef() { return draftInvoiceRef },
  get ensureUniqueServerRef() { return ensureUniqueServerRef },
  get fmtKes() { return fmtKes },
  get invRef() { return invRef },
  get numberDonations() { return numberDonations },
  get numberRefundPayments() { return numberRefundPayments },
  get numberReturns() { return numberReturns },
  get openTradeInRefurbJobs() { return openTradeInRefurbJobs },
  get orcRef() { return orcRef },
  get postSystemJournal() { return postSystemJournal },
  get prodRef() { return prodRef },
  get returnOrders() { return returnOrders },
  get saveInvoiceToServer() { return saveInvoiceToServer },
  get seesCustomerInvoices() { return seesCustomerInvoices },
  get serialRef() { return serialRef },
  get setBulkStock() { return setBulkStock },
  get setBuyBacks() { return setBuyBacks },
  get setClientExchanges() { return setClientExchanges },
  get setCustomerCredits() { return setCustomerCredits },
  get setDeliveries() { return setDeliveries },
  get setDonations() { return setDonations },
  get setInvoices() { return setInvoices },
  get setJournalEntries() { return setJournalEntries },
  get setOutboundReleases() { return setOutboundReleases },
  get setProducts() { return setProducts },
  get setRefundPayments() { return setRefundPayments },
  get setRepairs() { return setRepairs },
  get setReturnOrders() { return setReturnOrders },
  get setSaleOrders() { return setSaleOrders },
  get setSerials() { return setSerials },
  get setWarranties() { return setWarranties },
  get showToast() { return showToast },
  get soRef() { return soRef },
  get storeCtxRef() { return storeCtxRef },
  get syncOrWarn() { return syncOrWarn },
  get tradeInRef() { return tradeInRef },
  get upsertBulkStock() { return upsertBulkStock },
  get warranties() { return warranties },
}

  return storeDeps
}

export type StoreDeps = ReturnType<typeof useStoreCore>
