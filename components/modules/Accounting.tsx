'use client'

import { useMemo, useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { loadXlsx } from '@/lib/xlsx-lazy'
import {
  faArrowDown,
  faTriangleExclamation,
  faMoneyBillWave,
  faArrowUp,
  faBook,
  faBalanceScale,
  faChartLine,
  faListUl,
  faUsers,
  faPrint,
  faDownload,
  faPlus,
  faTrash,
  faFileInvoiceDollar,
} from '@fortawesome/free-solid-svg-icons'

import {
  useFinanceStore,
  Invoice,
  InvoiceLine,
  JournalEntry,
  RefundPayment,
  Account,
  fmtKes,
  fmtDate,
} from '@/lib/store'
import { downloadPdf, printPdf, PdfLine } from '@/lib/pdf'
import { downloadInvoicePdf } from '@/components/modules/invoice-pdf'
import { CO } from '@/lib/company'
import {
  invoiceDocState,
  invoicePaymentStatus,
  financeListPaymentStatusLabel,
  isInvoiceOverdue,
  isOpenInvoice,
  invoiceResidual,
  displayDocRef,
  INVOICE_DOC_STATE_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/lib/odoo-sales-flow'
import { exportToPDF, exportToExcel, type ExportRow } from '@/lib/export-utils'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import {
  Badge,
  Modal,
  Field,
  Input,
  Select,
  PanelHeader,
  Divider,
  SearchPicker,
  ModuleSkeleton,
  ModuleHeader,
  useMounted,
  TabContent,
  RecordCard,
  TabBar,
  StatePanel,
} from '@/components/ui'
import { PrimaryActionButton } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { Fa } from '@/components/icons'
import CashbookTab, { buildCashbookEntries } from './Cashbook'
import { computeCashbookTotals, cashPositionFromTotals } from '@/lib/finance-alerts'
import { financeInvoicePath, parseFinanceListPage, shouldApplyInvoiceEditQuery } from '@/lib/finance-invoice'
import { AccountingProvider } from './accounting/AccountingContext'
import FinancialReportTab from './accounting/FinancialReportTab'
import JournalsTab from './accounting/JournalsTab'
import ChartOfAccountsTab from './accounting/ChartOfAccountsTab'
import GeneralLedgerTab from './accounting/GeneralLedgerTab'
import PartnerLedgerTab from './accounting/PartnerLedgerTab'
import CustomerCreditsTab from './accounting/CustomerCreditsTab'
import CommissionsTab from './accounting/CommissionsTab'
import AgeingTab from './accounting/AgeingTab'
import IntegrityDashboard from './accounting/IntegrityDashboard'
import CashFlowPanel from './accounting/CashFlowPanel'
import AccountingDashboard from './accounting/AccountingDashboard'
import { usePrismaAccountingReports, bootstrapCoaClient } from '@/hooks/usePrismaAccountingReports'
import {
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
  alignPaymentDetailsToTax,
  documentHasVat,
  normalizeDocumentPaymentDetails,
  type DocumentPaymentDetails,
} from '@/lib/document-payment-details'
import PaymentDetailsPicker from '@/components/payment/PaymentDetailsPicker'
import ContactFormModal, { blankCompanyContact, blankIndividualContact } from '@/components/contacts/ContactFormModal'
import { useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

type MainTab =
  | 'dashboard'
  | 'invoices'
  | 'bills'
  | 'journals'
  | 'refunds'
  | 'credits'
  | 'commissions'
  | 'coa'
  | 'gl'
  | 'partner_ledger'
  | 'reports'
  | 'migration'
  | 'pl'
  | 'bs'
  | 'vat'
  | 'ageing'
  | 'trial_balance'
  | 'cash_position'
  | 'monthly'
  | 'cashbook'
  | 'integrity'
  | 'cash_flow'

type FinanceSection = 'overview' | 'money_in' | 'money_out' | 'banking' | 'accounting' | 'reports'

const FINANCE_SECTIONS: Array<{ id: FinanceSection; label: string; defaultTab: MainTab }> = [
  { id: 'overview', label: 'Overview', defaultTab: 'dashboard' },
  { id: 'money_in', label: 'Invoices', defaultTab: 'invoices' },
  { id: 'money_out', label: 'Bills', defaultTab: 'bills' },
  { id: 'banking', label: 'Banking', defaultTab: 'cashbook' },
  { id: 'accounting', label: 'Accounting', defaultTab: 'journals' },
  { id: 'reports', label: 'Reports', defaultTab: 'reports' },
]

const FINANCE_SECTION_TABS: Record<FinanceSection, Array<{ id: MainTab; label: string }>> = {
  overview: [{ id: 'dashboard', label: 'Action centre' }],
  money_in: [
    { id: 'invoices', label: 'Customer invoices' },
    { id: 'credits', label: 'Customer credits' },
    { id: 'refunds', label: 'Refunds' },
    { id: 'commissions', label: 'Sales commissions' },
  ],
  money_out: [{ id: 'bills', label: 'Vendor bills' }],
  banking: [{ id: 'cashbook', label: 'Cashbook & reconciliation' }],
  accounting: [
    { id: 'journals', label: 'Accounting entries' },
    { id: 'coa', label: 'Chart of accounts' },
    { id: 'gl', label: 'General ledger' },
    { id: 'partner_ledger', label: 'Customer & supplier ledger' },
    { id: 'integrity', label: 'Integrity controls' },
    { id: 'migration', label: 'Data migration' },
  ],
  reports: [{ id: 'reports', label: 'Financial reports' }],
}

const FINANCE_TAB_SECTION: Partial<Record<MainTab, FinanceSection>> = Object.fromEntries(
  Object.entries(FINANCE_SECTION_TABS).flatMap(([section, tabs]) =>
    tabs.map(item => [item.id, section as FinanceSection]),
  ),
)

type ReportTab = 'financial_report' | 'monthly' | 'pl' | 'bs' | 'vat' | 'ageing' | 'trial_balance' | 'cash_position' | 'fx' | 'cash_flow'
const REPORT_TABS: Array<{ id: ReportTab; label: string; icon: any }> = [
  { id: 'financial_report', label: 'Financial report', icon: faChartLine },
  { id: 'monthly', label: 'Monthly', icon: faChartLine },
  { id: 'pl', label: 'P&L', icon: faChartLine },
  { id: 'bs', label: 'Balance sheet', icon: faBalanceScale },
  { id: 'vat', label: 'VAT', icon: faFileInvoiceDollar },
  { id: 'ageing', label: 'Ageing', icon: faUsers },
  { id: 'trial_balance', label: 'Trial balance', icon: faBalanceScale },
  { id: 'cash_flow', label: 'Cash flow', icon: faMoneyBillWave },
  { id: 'cash_position', label: 'Cash position', icon: faMoneyBillWave },
  { id: 'fx', label: 'FX revaluation', icon: faMoneyBillWave },
]
const REPORT_TAB_IDS = new Set<ReportTab>(['financial_report', 'monthly', 'pl', 'bs', 'vat', 'ageing', 'trial_balance', 'cash_position', 'fx', 'cash_flow'])
const MANAGEMENT_REPORT_IDS = new Set<ReportTab>(['pl', 'bs', 'cash_flow', 'ageing', 'financial_report'])
const CONTROL_REPORT_IDS = new Set<ReportTab>(['monthly', 'vat', 'trial_balance', 'cash_position', 'fx'])

// ── Balance Sheet group lists ─────────────────────────────────────────────────
const CA_GROUPS = [
  'Inventory - Closing',
  'Receivables - Product',
  'Receivables - Services',
  'Receivables - Repair',
  'Receivables - Other',
  'Prepayments - Product',
  'Prepayments - Services',
  'Prepayments - Repair',
  'Prepayments - Other',
  'Cash at Bank',
  'Cash in Hand',
]
const NCA_GROUPS = ['PPE - Cost', 'Accumulated Depreciation']
const CL_GROUPS = [
  'Payables - Product',
  'Payables - Services',
  'Payables - Repair',
  'Payables - Other',
  'Accruals',
  'Statutory Liabilities',
]
const NCL_GROUPS = ['Non-Current Liabilities']

// ── P&L group lists ───────────────────────────────────────────────────────────
const REV_GROUPS = ['Revenue - Products', 'Revenue - Solutions', 'Revenue - Repair']
const OI_GROUPS = ['Other Income']
const OS_GROUPS = ['Inventory - Opening'] // Opening Stock (COGS)
const PUR_GROUPS = ['Local Purchases', 'Import Purchases']
const DIRECT_GROUPS = ['Direct Expenses', 'Other Direct Expenses']
const CS_GROUPS = ['Inventory - Closing'] // Closing Stock (negative in COGS)
const OPEX_GROUPS = ['Operating Expenses']
const EMP_GROUPS = ['Employment Expenses']
const FIN_GROUPS = ['Financial Expenses']

const uid = () => crypto.randomUUID()
const today = () => new Date().toISOString().slice(0, 10)
const cell = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const direct = row[key]
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim()
    const actualKey = Object.keys(row).find(candidate => candidate.trim().toLowerCase() === key.trim().toLowerCase())
    const value = actualKey ? row[actualKey] : undefined
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}
const addDays = (d: string, n: number) => {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}
const FISCAL_YEAR = new Date().getFullYear().toString()
const REPORT_DATE = new Date().toLocaleDateString('en-KE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
type ManualInvoiceLine = { type: 'item' | 'section'; desc: string; qty: string; price: string; tax: string; discount: string }
const newManualInvoiceLine = (): ManualInvoiceLine => ({ type: 'item', desc: '', qty: '1', price: '', tax: '0', discount: '0' })
const newManualSectionLine = (): ManualInvoiceLine => ({ type: 'section', desc: '', qty: '0', price: '0', tax: '0', discount: '0' })
// Odoo-style invoice badge: the document state (Draft/Posted/Cancelled) with
// the computed payment status shown for posted documents; Overdue is a
// separate computed badge, never a document state.
function invoiceBadge(i: Pick<Invoice, 'status' | 'total' | 'amountPaid' | 'dueDate'> & { payments?: any[] }) {
  const docState = invoiceDocState(i.status)
  const payState = invoicePaymentStatus(i)
  const overdue = isInvoiceOverdue(i)
  if (docState === 'draft') return { status: 'pending', label: INVOICE_DOC_STATE_LABELS.draft, overdue: false }
  if (docState === 'cancelled') return { status: 'cancelled', label: payState === 'reversed' ? PAYMENT_STATUS_LABELS.reversed : INVOICE_DOC_STATE_LABELS.cancelled, overdue: false }
  const status = payState === 'paid' ? 'active'
    : payState === 'blocked' ? 'cancelled'
    : payState === 'partially_paid' || payState === 'in_payment' ? 'warning'
    : 'pending'
  return { status, label: PAYMENT_STATUS_LABELS[payState], overdue }
}

const monthKey = (date?: string) => {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return String(date).slice(0, 7)
  return d.toISOString().slice(0, 7)
}
const monthLabel = (key: string) => {
  const d = new Date(`${key}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════

const row = (label: string, value: string, y: number, bold = false, indent = 0): PdfLine[] => [
  { text: label, x: 40 + indent, y, size: 10, bold },
  { text: value, x: 430, y, size: 10, bold },
]
const sectionHeader = (label: string, y: number): PdfLine[] => [
  { text: label, x: 40, y, size: 11, bold: true },
]

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function Accounting() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <AccountingContent />
    </Suspense>
  )
}

function AccountingContent() {
  const mounted = useMounted()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const appState = useFinanceStore()
  const {
    invoices,
    contacts,
    journalEntries,
    refundPayments,
    users,
    currentUserId,
    registerPayment,
    deleteInvoice,
    updateInvoice,
    postInvoice,
    createManualInvoice,
    showToast,
    accounts,
    addAccount,
    updateAccount,
    bankAccounts,
    addBankAccount,
    bankRecons,
    bankStatementLines,
    posOrders,
    products,
    expenses,
    payrollRuns,
    purchaseOrders,
    deposits,
    companySettings,
    saleOrders,
    getDocumentPaymentDetails,
    setDocumentPaymentDetails,
  } = appState

  // Dynamic PDF header builder using live companySettings
  const primaryBank = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
  const hdr = (lines: PdfLine[], title: string, subtitle: string): PdfLine[] => {
    const bankLine = primaryBank
      ? `Bank: ${primaryBank.bankName} | Acct: ${primaryBank.accountNo}`
      : `Bank: ${CO.bankName} | Acct: ${CO.bankAccount} | Branch: ${CO.bankBranch} | SWIFT: ${CO.swiftCode}`
    const mpesaLine = `M-Pesa Paybill: ${companySettings.mpesaPaybill || CO.mpesaPaybill}, Acct: ${
      companySettings.mpesaAccount || CO.mpesaAccount
    }`
    return [
      { text: companySettings.name, x: 40, y: 810, size: 13, bold: true },
      { text: `${companySettings.address}, ${companySettings.city}`, x: 40, y: 796, size: 8 },
      { text: `Tel: ${companySettings.phone}  |  ${companySettings.website}`, x: 40, y: 785, size: 8 },
      { text: `KRA PIN: ${companySettings.kraPin}`, x: 40, y: 774, size: 8 },
      {
        text: `Prepared: ${new Date().toLocaleDateString('en-KE', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}`,
        x: 430,
        y: 810,
        size: 8,
      },
      { text: title, x: 40, y: 756, size: 13, bold: true },
      { text: subtitle, x: 40, y: 742, size: 8 },
      { text: '—'.repeat(80), x: 40, y: 733, size: 9 },
      ...lines,
      { text: '—'.repeat(80), x: 40, y: 110, size: 9 },
      { text: 'Prepared by: _________________________', x: 40, y: 88, size: 8 },
      { text: 'Approved by: _________________________', x: 295, y: 88, size: 8 },
      {
        text: `${companySettings.name}  ·  ${companySettings.address}  ·  ${companySettings.phone}  ·  KRA: ${companySettings.kraPin}`,
        x: 40,
        y: 62,
        size: 7,
      },
      { text: bankLine, x: 40, y: 52, size: 7 },
      { text: `${mpesaLine}  ·  Accrual basis — IFRS compliant`, x: 40, y: 42, size: 7 },
    ]
  }

  // ── Cashbook-derived cash balances (for Balance Sheet) ────────────────────
  const allCashbookEntries = useMemo(
    () =>
      buildCashbookEntries(
        { invoices, posOrders, expenses, journalEntries, deposits },
        accounts
      ),
    [invoices, posOrders, expenses, journalEntries, deposits, accounts]
  )
  const cashbookTotals = useMemo(
    () => computeCashbookTotals(bankAccounts, allCashbookEntries),
    [allCashbookEntries, bankAccounts]
  )
  const { cashAtBank: cashAtBankBS, cashInHand: cashInHandBS } = cashPositionFromTotals(cashbookTotals)

  const defaultTab: MainTab = 'dashboard'
  const queryTab = searchParams.get('tab') as MainTab | null
  const queryReport = searchParams.get('report') as ReportTab | null
  const isReportTabId = (value: string | null | undefined): value is ReportTab =>
    !!value && REPORT_TAB_IDS.has(value as ReportTab)
  const initialReportTab: ReportTab = (isReportTabId(queryReport) ? queryReport : isReportTabId(queryTab) ? queryTab : 'pl')
  const initialTab: MainTab = isReportTabId(queryTab) ? 'reports' : (queryTab ?? defaultTab)

  const [tab, setLocalTab] = useState<MainTab>(initialTab)
  const [reportTab, setReportTab] = useState<ReportTab>(initialReportTab)
  const activeTab = tab === 'reports' ? reportTab : tab
  const urlInvoiceListPage = parseFinanceListPage(searchParams.get('page'))
  const [invoiceListPage, setInvoiceListPageState] = useState(urlInvoiceListPage)
  useEffect(() => {
    setInvoiceListPageState(urlInvoiceListPage)
  }, [urlInvoiceListPage])

  const setTab = (newTab: MainTab) => {
    const nextTab = isReportTabId(newTab) ? 'reports' : newTab
    if (nextTab === tab && !(isReportTabId(newTab) && newTab !== reportTab)) return
    if (isReportTabId(newTab)) setReportTab(newTab)
    setLocalTab(nextTab)
    setSelectedInvIds(new Set())
    setInvoiceListPageState(1)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextTab)
    if (nextTab === 'reports') params.set('report', isReportTabId(newTab) ? newTab : reportTab)
    else params.delete('report')
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setReport = (newReport: ReportTab) => {
    setReportTab(newReport)
    setLocalTab('reports')
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'reports')
    params.set('report', newReport)
    params.delete('page')
    setInvoiceListPageState(1)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as MainTab | null
    const urlReport = searchParams.get('report') as ReportTab | null
    // URL → local only. Do not depend on `tab`/`reportTab` or optimistic clicks
    // re-apply a stale URL (e.g. Bills snaps back to Invoices).
    if (isReportTabId(urlTab)) {
      setLocalTab('reports')
      setReportTab(urlTab)
    } else if (urlTab) {
      setLocalTab(urlTab)
    }
    if (isReportTabId(urlReport)) {
      setReportTab(urlReport)
    }
  }, [searchParams])

  // Persist CoA blob when missing (Contabo had no deed_accounts) — never wipes balances.
  useEffect(() => {
    if (!mounted) return
    if (Array.isArray(accounts) && accounts.length > 0) return
    void bootstrapCoaClient()
      .then(() => showToast('Chart of Accounts bootstrapped (zero-balance template)'))
      .catch(() => {})
  }, [mounted, accounts, showToast])

  const [tbSource, setTbSource] = useState<'blob' | 'prisma'>('prisma')
  const [plSource, setPlSource] = useState<'blob' | 'prisma'>('prisma')
  const [bsSource, setBsSource] = useState<'blob' | 'prisma'>('prisma')
  const [vatSource, setVatSource] = useState<'blob' | 'prisma'>('prisma')
  const fiscalYearStart = `${new Date().getFullYear()}-01-01`
  const [pnlDateFrom, setPnlDateFrom] = useState(fiscalYearStart)
  const [pnlDateTo, setPnlDateTo] = useState(today())
  const prismaReportsEnabled = (tbSource === 'prisma' && reportTab === 'trial_balance')
    || (plSource === 'prisma' && reportTab === 'pl')
    || (bsSource === 'prisma' && reportTab === 'bs')
    || (vatSource === 'prisma' && reportTab === 'vat')
  const prismaReports = usePrismaAccountingReports(prismaReportsEnabled, {
    trialBalance: tbSource === 'prisma' && reportTab === 'trial_balance',
    profitLoss: plSource === 'prisma' && reportTab === 'pl',
    balanceSheet: bsSource === 'prisma' && reportTab === 'bs',
    vatControl: vatSource === 'prisma' && reportTab === 'vat',
    plDateFrom: plSource === 'prisma' && reportTab === 'pl' ? pnlDateFrom : null,
    plDateTo: plSource === 'prisma' && reportTab === 'pl' ? pnlDateTo : null,
    plView: 'management',
  })

  const [journalSot, setJournalSot] = useState<{
    ok: boolean
    certified: boolean
    certifiedAt?: string | null
    coveragePct?: number | null
    retireReady?: boolean
  } | null>(null)

  useEffect(() => {
    if (tab !== 'reports') return
    let cancelled = false
    void fetch('/api/admin/journal-parity')
      .then(async res => {
        if (!res.ok) return null
        return res.json()
      })
      .then(data => {
        if (cancelled || !data) return
        const coverage = data.refs?.coveragePct ?? null
        const certified = data.certificate?.status === 'certified' || data.certificate?.status === 'archived'
        setJournalSot({
          ok: Boolean(data.ok),
          certified: Boolean(certified && data.certificate?.parityOk),
          certifiedAt: data.certificate?.certifiedAt ?? null,
          coveragePct: coverage,
          retireReady: Boolean(data.retireReadiness?.retireReady),
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tab])

  // ── Invoice / Bill state ────────────────────────────────────────────────────
  const patchInvoiceUi = useUrlUiPatch()
  const [invFilter, setInvFilterValue] = useUrlUiState('filter', 'all')
  const [invSearch, setInvSearchValue] = useUrlUiState('q', '')
  const setInvFilter = useCallback((value: string) => {
    setInvoiceListPageState(1)
    setInvFilterValue(value, { queryPatch: { page: null } })
  }, [setInvFilterValue])
  const setInvSearch = useCallback((value: string) => {
    setInvoiceListPageState(1)
    setInvSearchValue(value, { queryPatch: { page: null } })
  }, [setInvSearchValue])
  const clearInvoiceFilters = useCallback(() => {
    setInvoiceListPageState(1)
    patchInvoiceUi({ q: null, filter: null, page: null })
  }, [patchInvoiceUi])
  const setInvoiceListPage = useCallback((nextPage: number) => {
    const page = parseFinanceListPage(nextPage)
    setInvoiceListPageState(page)
    if (page === parseFinanceListPage(searchParams.get('page'))) return
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) params.delete('page')
    else params.set('page', String(page))
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])
  const openInvoiceRecord = useCallback((id: string) => {
    router.push(financeInvoicePath(id, {
      listPage: invoiceListPage,
      listSearch: invSearch,
      listFilter: invFilter,
    }))
  }, [invoiceListPage, invSearch, invFilter, router])
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(new Set())
  const [showBulkPayModal, setShowBulkPayModal] = useState(false)
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('mpesa')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payDate, setPayDate] = useState(today())
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingInvId, setEditingInvId] = useState<string | null>(null)
  const [newPartnerId, setNewPartnerId] = useState('')
  const [newPartnerName, setNewPartnerName] = useState('')
  const [newDocumentDate, setNewDocumentDate] = useState(today())
  const [newDueDate, setNewDueDate] = useState(today())
  const [newLines, setNewLines] = useState<ManualInvoiceLine[]>([newManualInvoiceLine()])
  const moveNewLine = (index: number, direction: -1 | 1) => {
    setNewLines(prev => {
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  const [newNotes, setNewNotes] = useState('')
  const [newPaymentDetails, setNewPaymentDetails] = useState<DocumentPaymentDetails>({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
  const [applyVat, setApplyVat] = useState(false)
  const [changingPartner, setChangingPartner] = useState(false)
  const [showCreatePartner, setShowCreatePartner] = useState(false)
  const [createPartnerSeed, setCreatePartnerSeed] = useState('')
  const [createPartnerKey, setCreatePartnerKey] = useState(0)
  const [localInvoices, setLocalInvoices] = useState<Invoice[]>([])

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const billFileRef = useRef<HTMLInputElement>(null)
  const migrationFileRef = useRef<HTMLInputElement>(null)
  const [migrationImporting, setMigrationImporting] = useState(false)
  const [migrationSummary, setMigrationSummary] = useState<string | null>(null)

  // ── Journal state ───────────────────────────────────────────────────────────
  const [viewJournal, setViewJournal] = useState<JournalEntry | null>(null)
  const [journalDate, setJournalDate] = useState('')
  const [journalSource, setJournalSource] = useState('all')
  const [journalRef, setJournalRef] = useState('')

  // ── Chart of Accounts state ─────────────────────────────────────────────────
  const [coaSearch, setCoaSearch] = useState('')
  const [coaTypeFilter, setCoaTypeFilter] = useState<'all' | Account['type']>('all')
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [editAccountId, setEditAccountId] = useState<string | null>(null)
  const [accountForm, setAccountForm] = useState<Omit<Account, 'id'>>({
    code: '',
    name: '',
    type: 'asset',
    group: '',
    subGroup: '',
    isActive: true,
    balance: 0,
    notes: '',
  })

  // ── General Ledger state ────────────────────────────────────────────────────
  const [glAccount, setGlAccount] = useState('')
  const [glDateFrom, setGlDateFrom] = useState('')
  const [glDateTo, setGlDateTo] = useState('')

  // ── Partner Ledger state ────────────────────────────────────────────────────
  const [plPartner, setPlPartner] = useState('')
  const [plDateFrom, setPlDateFrom] = useState('')
  const [plDateTo, setPlDateTo] = useState('')
  const [monthlyReportMonth, setMonthlyReportMonth] = useState(today().slice(0, 7))

  // ── Derived data ────────────────────────────────────────────────────────────
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const canViewJournals = !!currentUser && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
  const canManageFinance = !!currentUser && ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')
  const canManageFullFinance = !!currentUser && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
  const customers = contacts.filter(c => c.isCustomer)
  const vendors = contacts.filter(c => c.isVendor)
  const invoiceVatRate = companySettings.vatRate ?? 16

  // Align manual invoice payment bank: VAT → NCBA; non-VAT → ABSA / I&M
  useEffect(() => {
    const isVat = applyVat || newLines.some(l => Number(l.tax) > 0)
    setNewPaymentDetails(prev => {
      const next = alignPaymentDetailsToTax(prev, isVat, bankAccounts)
      const cur = normalizeDocumentPaymentDetails(prev)
      if (
        cur.useCompanyDefault === next.useCompanyDefault
        && cur.includeMpesa === next.includeMpesa
        && (cur.customNote || '') === (next.customNote || '')
        && cur.bankAccountIds.join() === next.bankAccountIds.join()
      ) return prev
      return next
    })
  }, [applyVat, newLines, bankAccounts])


  const reportMonthOptions = useMemo(() => {
    const months = new Set<string>([today().slice(0, 7)])
    invoices.forEach(i => months.add(monthKey(i.date)))
    posOrders.forEach(o => months.add(monthKey(o.date || o.createdAt)))
    expenses.forEach((e: any) => months.add(monthKey(e.expenseDate || e.submittedDate || e.createdAt)))
    purchaseOrders.forEach((po: any) => months.add(monthKey(po.date)))
    return Array.from(months).filter(Boolean).sort((a, b) => b.localeCompare(a))
  }, [invoices, posOrders, expenses, purchaseOrders])

  const invoicePreview = useMemo(() => {
    const lines = newLines.map((line, index) => {
      if (line.type === 'section') {
        return {
          index,
          lineType: 'section' as const,
          description: line.desc.trim(),
          qty: 0,
          unitPrice: 0,
          taxRate: 0,
          subtotal: 0,
          taxAmount: 0,
          total: 0,
          valid: !!line.desc.trim(),
        }
      }
      const qty = Number(line.qty)
      const unitPrice = Number(line.price)
      const normalizedQty = Number.isFinite(qty) && qty > 0 ? qty : 0
      const normalizedPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : -1
      const taxRate = applyVat ? invoiceVatRate : (Number(line.tax) || 0)
      const discountPct = Math.min(100, Math.max(0, Number(line.discount) || 0))
      const gross = normalizedQty > 0 && normalizedPrice >= 0 ? normalizedQty * normalizedPrice : 0
      const discountAmount = Math.round(gross * discountPct) / 100
      const subtotal = Math.max(0, gross - discountAmount)
      const taxAmount = Math.round(subtotal * taxRate / 100)
      return {
        index,
        lineType: 'item' as const,
        description: line.desc.trim(),
        qty: normalizedQty,
        unitPrice: Math.max(0, normalizedPrice),
        taxRate,
        discountPct,
        discountAmount,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
        valid: !!line.desc.trim() && normalizedQty > 0 && normalizedPrice > 0,
      }
    })
    const grossTotal = lines.reduce((sum, line) => sum + (line.subtotal + (line.discountAmount ?? 0)), 0)
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
    const taxTotal = lines.reduce((sum, line) => sum + line.taxAmount, 0)
    const discountTotal = lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0)
    const invalidLineIndexes = lines.filter(line => !line.valid).map(line => line.index)
    const itemLines = lines.filter(line => line.lineType !== 'section')
    return {
      lines,
      grossTotal,
      subtotal,
      taxTotal,
      discountTotal,
      total: subtotal + taxTotal,
      invalidLineIndexes,
      canSave: !!newPartnerId && invalidLineIndexes.length === 0 && itemLines.length > 0,
      blockedReason: !newPartnerId
        ? `Select a ${tab === 'bills' ? 'vendor' : 'customer'} before saving.`
        : invalidLineIndexes.length > 0
          ? 'Every item line needs a description, quantity greater than zero, and price greater than zero.'
          : itemLines.length === 0
            ? 'Add at least one billable line item.'
            : '',
    }
  }, [applyVat, invoiceVatRate, newLines, newPartnerId, tab])

  const {
    allInvoices,
    customerInvoices,
    vendorBills,
    outstandingAR,
    outstandingAP,
    totalRevenueDynamic,
  } = useMemo(() => {
    const all = [...invoices, ...localInvoices]
    const cust: Invoice[] = []
    const vend: Invoice[] = []
    let outAR = 0,
      outAP = 0,
      revDyn = 0

    for (const i of all) {
      const refLooksLikeBill = String(i.ref ?? '').toUpperCase().startsWith('BILL')
      if (i.type === 'vendor_bill' || refLooksLikeBill) {
        vend.push(i)
        if (isOpenInvoice(i)) outAP += invoiceResidual(i)
      } else if (i.type === 'customer_invoice') {
        cust.push(i)
        revDyn += i.subtotal
        if (isOpenInvoice(i)) outAR += invoiceResidual(i)
      }
    }
    return {
      allInvoices: all,
      customerInvoices: cust,
      vendorBills: vend,
      outstandingAR: outAR,
      outstandingAP: outAP,
      totalRevenueDynamic: revDyn,
    }
  }, [invoices, localInvoices])

  const filteredInvoices = useMemo(() => {
    const list = tab === 'invoices' ? customerInvoices : vendorBills
    const q = invSearch.toLowerCase()
    const res: Invoice[] = []
    for (const i of list) {
      // Odoo semantics: document state (Draft/Posted/Cancelled) is separate
      // from the computed payment status; Overdue is due date + residual.
      const docState = invoiceDocState(i.status)
      const payState = invoicePaymentStatus(i)
      let pass = false
      if (invFilter === 'all') pass = true
      else if (invFilter === 'unpaid') pass = docState === 'posted' && payState === 'not_paid'
      else if (invFilter === 'partially_paid') pass = payState === 'partially_paid'
      else if (invFilter === 'overdue') pass = isInvoiceOverdue(i)
      else if (invFilter === 'paid') pass = payState === 'paid'
      else if (invFilter === 'posted') pass = docState === 'posted'
      else if (invFilter === 'draft') pass = docState === 'draft'
      else if (invFilter === 'blocked') pass = payState === 'blocked'
      else pass = docState === invFilter

      if (pass) {
        if (
          !q ||
          i.ref.toLowerCase().includes(q) ||
          i.partnerName.toLowerCase().includes(q)
        ) {
          res.push(i)
        }
      }
    }
    return res.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [tab, customerInvoices, vendorBills, invFilter, invSearch])

  const sourceReferenceForInvoice = (invoice: Invoice): string => {
    const explicit = String(
      (invoice as Invoice & { sourceRef?: string }).sourceRef
      || (invoice as Invoice & { saleOrderRef?: string }).saleOrderRef
      || (invoice as Invoice & { purchaseOrderRef?: string }).purchaseOrderRef
      || '',
    ).trim()
    if (explicit) return explicit
    if (invoice.type === 'customer_invoice' && invoice.saleOrderId) {
      return saleOrders.find(order => order.id === invoice.saleOrderId)?.ref || '—'
    }
    if (invoice.type === 'vendor_bill' && invoice.purchaseOrderId) {
      return purchaseOrders.find(order => order.id === invoice.purchaseOrderId)?.ref || '—'
    }
    return '—'
  }

  const documentCurrencyAmount = (invoice: Invoice, amount: number): string => {
    const code = String(invoice.currencyCode || companySettings.currency || 'KES').toUpperCase()
    try {
      return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: /^[A-Z]{3}$/.test(code) ? code : 'KES',
        maximumFractionDigits: 2,
      }).format(amount)
    } catch {
      return code + ' ' + amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })
    }
  }

  const financeHeader: Record<MainTab, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Accounting Dashboard',
      subtitle: 'Financial performance, liquidity, obligations and control exceptions',
    },
    invoices: {
      title: 'Customer invoices',
      subtitle: `${customerInvoices.length} records · ${fmtKes(outstandingAR)} outstanding`,
    },
    bills: {
      title: 'Vendor bills',
      subtitle: `${vendorBills.length} records · ${fmtKes(outstandingAP)} outstanding`,
    },
    credits: { title: 'Customer credits', subtitle: 'Credit balances and applications' },
    commissions: { title: 'Salespeople', subtitle: 'Commission statements and payment status' },
    refunds: { title: 'Refunds', subtitle: 'Approved customer refund payments' },
    journals: { title: 'Accounting entries', subtitle: 'Posted entries and audit-ready movements' },
    reports: { title: 'Financial reports', subtitle: 'Management, statutory and control reports' },
    cashbook: { title: 'Cashbook', subtitle: 'Daily transactions and bank reconciliation' },
    coa: { title: 'Chart of accounts', subtitle: 'Accounts, groups and liquidity ledgers' },
    gl: { title: 'General ledger', subtitle: 'Account movements and running balances' },
    partner_ledger: { title: 'Customer & supplier ledger', subtitle: 'Customer and supplier account history' },
    migration: { title: 'Data migration', subtitle: 'Import opening balances and legacy records' },
    monthly: { title: 'Monthly report', subtitle: 'Management performance for the selected month' },
    pl: { title: 'Profit and loss', subtitle: 'Income and expenses for the selected period' },
    bs: { title: 'Balance sheet', subtitle: 'Assets, liabilities and equity' },
    vat: { title: 'VAT report', subtitle: 'Output tax, input tax and control balance' },
    ageing: { title: 'Ageing', subtitle: 'Outstanding receivables and payables by age' },
    trial_balance: { title: 'Trial balance', subtitle: 'Debit and credit balances by account' },
    cash_position: { title: 'Cash position', subtitle: 'Available balances across active accounts' },
    cash_flow: { title: 'Cash flow', subtitle: 'Operating, investing and financing cash movements' },
    integrity: { title: 'Finance integrity', subtitle: 'Month-end control gates and certification' },
  }

  const invoicePrimaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All status',
      value: invFilter,
      options: [
        { value: 'all', label: 'All status' },
        { value: 'unpaid', label: 'Not paid' },
        { value: 'partially_paid', label: 'Partially paid' },
        { value: 'draft', label: 'Draft' },
        { value: 'posted', label: 'Posted' },
        { value: 'paid', label: 'Paid' },
        { value: 'overdue', label: 'Overdue' },
        { value: 'blocked', label: 'Blocked' },
      ],
        onChange: (value: string) => { setInvFilter(value) },
    },
  ]


  const financeReports = useMemo(() => {
    const postedCustomerInvoices = customerInvoices.filter(i => invoiceDocState(i.status) === 'posted')
    const postedVendorBills = vendorBills.filter(i => invoiceDocState(i.status) === 'posted')
    const outputVat = postedCustomerInvoices.reduce((s, i) => s + (i.taxTotal || 0), 0)
    const inputVat = postedVendorBills.reduce((s, i) => s + (i.taxTotal || 0), 0)
    const vatPayable = outputVat - inputVat

    const trialBalance = accounts
      .map(acc => {
        const movement = journalEntries.reduce((sum, je) => sum + je.lines.filter(line => line.account === acc.name || line.account.startsWith(`${acc.code} -`) || line.account.includes(acc.name)).reduce((lineSum, line) => lineSum + line.debit - line.credit, 0), 0)
        const normalDebit = ['asset', 'expense'].includes(acc.type)
        const balance = (acc.balance || 0) + movement
        return { id: acc.id, code: acc.code, name: acc.name, type: acc.type, debit: normalDebit ? Math.max(balance, 0) : Math.max(-balance, 0), credit: normalDebit ? Math.max(-balance, 0) : Math.max(balance, 0) }
      })
      .filter(row => row.debit > 0 || row.credit > 0)
      .sort((a, b) => a.code.localeCompare(b.code))
    const tbTotals = trialBalance.reduce((a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }), { debit: 0, credit: 0 })

    const cashPosition = bankAccounts.map(acc => {
      const movements = allCashbookEntries.filter(e => e.bankAccountId === acc.id)
      const inflows = movements.reduce((s, e) => s + e.credit, 0)
      const outflows = movements.reduce((s, e) => s + e.debit, 0)
      return { id: acc.id, name: acc.name, bankName: acc.bankName, opening: acc.openingBalance, inflows, outflows, balance: acc.openingBalance + inflows - outflows, active: acc.active }
    })
    const cashTotals = cashPosition.reduce((a, r) => ({ opening: a.opening + r.opening, inflows: a.inflows + r.inflows, outflows: a.outflows + r.outflows, balance: a.balance + r.balance }), { opening: 0, inflows: 0, outflows: 0, balance: 0 })

    return { vat: { outputVat, inputVat, vatPayable, taxableSales: postedCustomerInvoices.reduce((s, i) => s + i.subtotal, 0), taxablePurchases: postedVendorBills.reduce((s, i) => s + i.subtotal, 0) }, trialBalance, tbTotals, cashPosition, cashTotals }
  }, [customerInvoices, vendorBills, accounts, journalEntries, bankAccounts, allCashbookEntries])

  const monthlyReport = useMemo(() => {
    const productById = new Map(products.map((product: any) => [product.id, product]))
    const categoryRows = new Map<string, { category: string; qty: number; revenue: number; cost: number; profit: number }>()
    const addCategorySale = (category: string, qty: number, revenue: number, cost: number) => {
      const key = category || 'Uncategorised'
      const row = categoryRows.get(key) ?? { category: key, qty: 0, revenue: 0, cost: 0, profit: 0 }
      row.qty += qty
      row.revenue += revenue
      row.cost += cost
      row.profit = row.revenue - row.cost
      categoryRows.set(key, row)
    }

    // createPOSOrder (lib/store.tsx) posts a fully-paid customer_invoice for
    // every POS sale (notes: `POS ${order.ref}`) — that invoice's lines are
    // NOT excluded here, they would double-count revenue/cost/cashCollected
    // against the SAME sale's raw POSOrder record already summed below via
    // monthPosOrders. Excluding POS-tagged invoices makes each POS sale
    // count exactly once, via its richer original POSOrder line data.
    const postedCustomerInvoices = customerInvoices.filter(i =>
      invoiceDocState(i.status) === 'posted' &&
      monthKey(i.date) === monthlyReportMonth &&
      !i.notes?.startsWith('POS ')
    )
    postedCustomerInvoices.forEach(invoice => {
      invoice.lines.forEach(line => {
        const product = productById.get(line.productId ?? '')
        const category = product?.category ?? (invoice.repairId ? 'Repairs' : 'Services')
        const cost = Number(product?.costPrice ?? 0) * Number(line.qty || 0)
        addCategorySale(category, Number(line.qty || 0), Number(line.subtotal || 0), cost)
      })
    })

    const monthPosOrders = posOrders.filter(order => monthKey(order.date || order.createdAt) === monthlyReportMonth)
    monthPosOrders.forEach(order => {
      order.lines.forEach(line => {
        const product = productById.get(line.productId ?? '')
        const category = product?.category ?? 'POS'
        const cost = Number(product?.costPrice ?? 0) * Number(line.qty || 0)
        addCategorySale(category, Number(line.qty || 0), Number(line.subtotal || 0), cost)
      })
    })

    const monthExpenses = expenses.filter((expense: any) =>
      monthKey(expense.expenseDate || expense.submittedDate || expense.createdAt) === monthlyReportMonth &&
      !['rejected'].includes(expense.status)
    )
    const expensesByCategory = new Map<string, { category: string; amount: number; count: number }>()
    monthExpenses.forEach((expense: any) => {
      const key = expense.category || 'Other'
      const row = expensesByCategory.get(key) ?? { category: key, amount: 0, count: 0 }
      row.amount += Number(expense.amount || 0)
      row.count += 1
      expensesByCategory.set(key, row)
    })

    const monthBills = vendorBills.filter(bill =>
      invoiceDocState(bill.status) === 'posted' &&
      monthKey(bill.date) === monthlyReportMonth
    )

    const categorySummary = Array.from(categoryRows.values()).sort((a, b) => b.revenue - a.revenue)
    const expenseSummary = Array.from(expensesByCategory.values()).sort((a, b) => b.amount - a.amount)
    const invoiceRevenue = postedCustomerInvoices.reduce((sum, invoice) => sum + invoice.subtotal, 0)
    const posRevenue = monthPosOrders.reduce((sum, order) => sum + order.subtotal, 0)
    const repairRevenue = postedCustomerInvoices
      .filter(invoice => !!invoice.repairId || invoice.notes?.toLowerCase().includes('repair'))
      .reduce((sum, invoice) => sum + invoice.subtotal, 0)
    const totalRevenue = categorySummary.reduce((sum, row) => sum + row.revenue, 0)
    const estimatedCost = categorySummary.reduce((sum, row) => sum + row.cost, 0)
    const grossProfit = totalRevenue - estimatedCost
    const operatingExpenses = monthExpenses.reduce((sum, expense: any) => sum + Number(expense.amount || 0), 0)
    const supplierBills = monthBills.reduce((sum, bill) => sum + bill.subtotal, 0)
    const netProfit = grossProfit - operatingExpenses - supplierBills
    const cashCollected = postedCustomerInvoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0) + monthPosOrders.reduce((sum, order) => sum + order.total, 0)

    return {
      month: monthlyReportMonth,
      label: monthLabel(monthlyReportMonth),
      invoiceRevenue,
      posRevenue,
      repairRevenue,
      totalRevenue,
      estimatedCost,
      grossProfit,
      operatingExpenses,
      supplierBills,
      netProfit,
      cashCollected,
      invoicesCount: postedCustomerInvoices.length,
      posCount: monthPosOrders.length,
      expensesCount: monthExpenses.length,
      categorySummary,
      expenseSummary,
    }
  }, [monthlyReportMonth, products, customerInvoices, posOrders, expenses, vendorBills])

  // Auto-select bank account when payment method changes
  useEffect(() => {
    if (payMethod === 'mpesa') {
      setPayBankAccountId('mpesa')
    } else if (payMethod === 'cash') {
      setPayBankAccountId('cash')
    } else {
      const def = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
      if (def) setPayBankAccountId(def.id)
    }
  }, [payMethod, bankAccounts])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const resetInvForm = (opts?: { navigateToInvoiceId?: string | null }) => {
    setShowNewForm(false)
    setEditingInvId(null)
    setNewPartnerId('')
    setNewPartnerName('')
    setNewDocumentDate(today())
    setNewDueDate(today())
    setNewLines([newManualInvoiceLine()])
    setNewNotes('')
    setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
    setApplyVat(false)
    setChangingPartner(false)
    setReceiptFile(null)
    if (opts?.navigateToInvoiceId) {
      router.push(financeInvoicePath(opts.navigateToInvoiceId, {
        listPage: invoiceListPage,
        listSearch: invSearch,
        listFilter: invFilter,
      }))
      return
    }
    // Drop deep-link so refresh does not reopen a discarded editor.
    if (searchParams.get('edit')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('edit')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }
  }

  const handleEditInvoice = (inv: Invoice) => {
    if (inv.status !== 'draft') {
      showToast('Reset to draft first, then edit and save.', 'info')
      router.push(financeInvoicePath(inv.id, { listPage: invoiceListPage }))
      return
    }
    setEditingInvId(inv.id)
    setNewPartnerId(inv.partnerId)
    setNewPartnerName(inv.partnerName)
    setNewDocumentDate(inv.date || today())
    setNewDueDate(inv.dueDate || today())
    setNewLines((inv.lines || []).map(l => ({
      type: l.lineType === 'section' ? 'section' : 'item',
      desc: l.description,
      qty: String(l.qty),
      price: String(l.unitPrice),
      tax: String(l.taxRate ?? 0),
      discount: String(l.discountPct ?? 0),
    })))
    setNewNotes(inv.notes ?? '')
    setNewPaymentDetails(
      inv.type === 'customer_invoice'
        ? getDocumentPaymentDetails(inv.id)
        : { ...DEFAULT_DOCUMENT_PAYMENT_DETAILS },
    )
    setApplyVat((inv.taxTotal ?? 0) > 0)
    setChangingPartner(false)
    setShowNewForm(true)
  }

  // Deep link: /finance?edit=<id> opens the invoice/bill editor and keeps
  // ?edit= in the URL so refresh restores the same form.
  const handledEditRef = useRef<string | null>(null)
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) {
      handledEditRef.current = null
      return
    }
    if (!shouldApplyInvoiceEditQuery(editId, handledEditRef.current)) return
    const inv = allInvoices.find(i => i.id === editId)
    if (!inv) return // wait until invoices hydrate — do not strip ?edit

    if (inv.status !== 'draft') {
      handledEditRef.current = editId
      showToast('Reset to draft first, then edit and save.', 'info')
      const params = new URLSearchParams(searchParams.toString())
      params.delete('edit')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      router.push(financeInvoicePath(inv.id, { listPage: invoiceListPage }))
      return
    }

    handledEditRef.current = editId
    handleEditInvoice(inv)
    const nextTab = inv.type === 'customer_invoice' ? 'invoices' : 'bills'
    setLocalTab(nextTab)
    setSelectedInvIds(new Set())

    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', nextTab)
    params.set('edit', editId)
    params.delete('report')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, allInvoices, pathname, router]) // eslint-disable-line react-hooks/exhaustive-deps

  const downloadSelectedInvoices = async (rows: Invoice[]) => {
    if (!rows.length) return
    setBulkDownloading(true)
    let ok = 0
    try {
      for (const inv of rows) {
        try {
          await downloadInvoicePdf(
            inv,
            saleOrders,
            contacts,
            companySettings,
            bankAccounts,
            inv.type === 'customer_invoice' ? getDocumentPaymentDetails(inv.id) : undefined,
          )
          ok += 1
          // Brief gap so the browser does not coalesce / block successive saves.
          await new Promise(r => setTimeout(r, 250))
        } catch {
          showToast(`Could not download ${displayDocRef(inv.ref)}`, 'error')
        }
      }
      if (ok > 0) showToast(`Downloaded ${ok} PDF${ok === 1 ? '' : 's'}`, 'success')
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleBillFile = async (file: File | null) => {
    if (!file) return
    setReceiptFile(file)
    setIsScanning(true)
    setTimeout(() => {
      setIsScanning(false)
      showToast('Bill uploaded — complete the form fields manually', 'info')
    }, 1500)
  }

  const downloadMigrationTemplate = async () => {
    const XLSX = await loadXlsx()
    const headers = ['Kind', 'Name', 'Email', 'Phone', 'Address', 'VAT Number', 'Opening Balance', 'Reference', 'Date', 'Due Date', 'Notes']
    const rows = [
      ['customer', 'Example Customer Ltd', 'accounts@example.com', '0712345678', 'Nairobi', 'P000000001A', 25000, 'OLD-INV-001', today(), addDays(today(), 30), 'Opening AR balance from old system'],
      ['vendor', 'Example Supplier Ltd', 'supplier@example.com', '0798765432', 'Nairobi', 'P000000002B', 18000, 'OLD-BILL-001', today(), addDays(today(), 30), 'Opening AP balance from old system'],
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = headers.map(() => ({ wch: 24 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Migration')
    XLSX.writeFile(wb, 'deed_erp_migration_template.xlsx')
  }

  const handleMigrationFile = (file: File | null) => {
    if (!file) return
    try { guardSpreadsheetFile(file) } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'File too large', 'error')
      return
    }
    setMigrationImporting(true)
    const reader = new FileReader()
    reader.onload = async event => {
      try {
        const XLSX = await loadXlsx()
        const data = new Uint8Array(event.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        guardSpreadsheetRows(rows)
        const existingByName = new Map(contacts.map(contact => [contact.name.trim().toLowerCase(), contact]))
        const importedContacts: any[] = []
        const importedInvoices: Invoice[] = []
        const seenNames = new Set<string>()
        const newContactIds = new Map<string, string>()

        rows.forEach((row, index) => {
          const kindRaw = cell(row, 'Kind', 'Type', 'Contact Type').toLowerCase()
          const isVendor = ['vendor', 'supplier', 'bill', 'ap', 'payable'].includes(kindRaw)
          const isCustomer = ['customer', 'client', 'invoice', 'ar', 'receivable'].includes(kindRaw) || !isVendor
          const name = cell(row, 'Name', 'Contact', 'Customer', 'Vendor', 'Supplier')
          if (!name) throw new Error(`Row ${index + 2}: Name is required`)
          const key = name.trim().toLowerCase()
          const balance = Number(cell(row, 'Opening Balance', 'Balance', 'Amount', 'Outstanding')) || 0
          if (balance < 0) throw new Error(`Row ${index + 2}: Opening Balance cannot be negative`)
          const existing = existingByName.get(key)
          const contactId = existing?.id ?? newContactIds.get(key) ?? `mig_contact_${uid()}`
          if (!existing && !newContactIds.has(key)) newContactIds.set(key, contactId)
          if (!existing && !seenNames.has(key)) {
            importedContacts.push({
              id: contactId,
              type: isVendor ? 'company' : 'individual',
              name,
              email: cell(row, 'Email'),
              phone: cell(row, 'Phone', 'Mobile'),
              address: cell(row, 'Address'),
              city: cell(row, 'City') || 'Nairobi',
              country: cell(row, 'Country') || 'Kenya',
              vatNumber: cell(row, 'VAT Number', 'PIN', 'KRA PIN'),
              isCustomer,
              isVendor,
              tags: ['migration'],
              createdAt: new Date().toISOString(),
            })
            seenNames.add(key)
          }
          if (balance > 0) {
            const type = isVendor ? 'vendor_bill' : 'customer_invoice'
            const ref = cell(row, 'Reference', 'Ref', 'Document Ref') || `${isVendor ? 'BILL' : 'INV'}-MIG-${String(importedInvoices.length + 1).padStart(4, '0')}`
            const date = cell(row, 'Date', 'Document Date') || today()
            const dueDate = cell(row, 'Due Date', 'Due') || date
            const line: InvoiceLine = {
              id: uid(),
              description: cell(row, 'Description') || 'Opening balance migrated from previous system',
              qty: 1,
              unitPrice: balance,
              taxRate: 0,
              subtotal: balance,
            }
            importedInvoices.push({
              id: `mig_invoice_${uid()}`,
              ref,
              type,
              status: 'posted',
              partnerId: contactId,
              partnerName: name,
              date,
              dueDate,
              lines: [line],
              subtotal: balance,
              taxTotal: 0,
              total: balance,
              amountPaid: 0,
              notes: cell(row, 'Notes') || 'Opening balance migrated from previous system',
            })
          }
        })

        if (importedContacts.length === 0 && importedInvoices.length === 0) {
          showToast('No valid migration rows found', 'error')
          return
        }
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(importedContacts.length ? { deed_contacts: importedContacts } : {}),
            ...(importedInvoices.length ? { deed_invoices: importedInvoices } : {}),
          }),
        })
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error || 'Migration import failed')
        const summary = `Imported ${importedContacts.length} contact(s) and ${importedInvoices.length} opening balance document(s).`
        setMigrationSummary(summary)
        showToast(`${summary} Reloading data...`, 'success')
        window.setTimeout(() => window.location.reload(), 1200)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not import migration file', 'error')
      } finally {
        setMigrationImporting(false)
        if (migrationFileRef.current) migrationFileRef.current.value = ''
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const createDocument = () => {
    if (!invoicePreview.canSave) {
      showToast(invoicePreview.blockedReason || 'Please complete the document before saving', 'error')
      return
    }
    const type = tab === 'invoices' ? 'customer_invoice' : 'vendor_bill'
    const vatRate = applyVat ? invoiceVatRate : 0
    let savedId: string | null = null

    if (editingInvId) {
      const existing = allInvoices.find(i => i.id === editingInvId)
      if (existing && existing.status !== 'draft') {
        showToast('Reset to draft first, then edit and save.', 'error')
        return
      }
      const builtLines = invoicePreview.lines.map(l => ({
        id: uid(),
        description: l.description,
        lineType: l.lineType,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        ...(l.discountPct ? { discountPct: l.discountPct } : {}),
        subtotal: l.subtotal,
      }))
      updateInvoice(editingInvId, {
        partnerId: newPartnerId,
        partnerName: newPartnerName,
        date: newDocumentDate,
        dueDate: newDueDate,
        lines: builtLines as any,
        subtotal: invoicePreview.subtotal,
        taxTotal: invoicePreview.taxTotal,
        total: invoicePreview.total,
        notes: newNotes,
      })
      if (type === 'customer_invoice') {
        setDocumentPaymentDetails(editingInvId, normalizeDocumentPaymentDetails(newPaymentDetails))
      }
      savedId = editingInvId
      showToast(tab === 'bills' ? 'Bill updated' : 'Invoice updated', 'success')
    } else {
      const created = createManualInvoice(type, newPartnerId, newPartnerName, newDueDate, newLines, vatRate, newNotes.trim(), newDocumentDate)
      if (type === 'customer_invoice' && created?.id) {
        setDocumentPaymentDetails(created.id, normalizeDocumentPaymentDetails(newPaymentDetails))
      }
      savedId = created?.id ?? null
    }
    if (savedId) handledEditRef.current = savedId
    resetInvForm({ navigateToInvoiceId: savedId })
  }

  const saveAccount = () => {
    if (!accountForm.code || !accountForm.name) {
      showToast('Code and Name are required', 'error')
      return
    }
    if (editAccountId) {
      updateAccount(editAccountId, accountForm)
      showToast('Account updated', 'success')
    } else {
      addAccount({ ...accountForm })
      showToast('Account created', 'success')
    }
    setShowAccountForm(false)
  }

  const af = (field: keyof typeof accountForm) => (val: any) =>
    setAccountForm(p => ({ ...p, [field]: val }))

  const ctxValue = {
    invoices, contacts, journalEntries, refundPayments, users, currentUserId,
    accounts, bankAccounts, posOrders, expenses, payrollRuns, purchaseOrders, companySettings,
    registerPayment, deleteInvoice, updateInvoice, postInvoice, createManualInvoice, addAccount, updateAccount, addBankAccount, showToast,
    currentUser, canViewJournals, canManageFinance, customers, vendors,
    allInvoices, customerInvoices, vendorBills, outstandingAR, outstandingAP, totalRevenueDynamic,
    cashAtBankBS, cashInHandBS, allCashbookEntries, cashbookTotals,
    tab, setTab,
    invFilter, setInvFilter, invSearch, setInvSearch,
    selectedInvIds, setSelectedInvIds, showBulkPayModal, setShowBulkPayModal,
    payAmount, setPayAmount, payMethod, setPayMethod,
    payBankAccountId, setPayBankAccountId, payReference, setPayReference, payDate, setPayDate,
    showNewForm, setShowNewForm, editingInvId, setEditingInvId,
    newPartnerId, setNewPartnerId, newPartnerName, setNewPartnerName,
    newDueDate, setNewDueDate, newLines, setNewLines, applyVat, setApplyVat,
    localInvoices, setLocalInvoices, receiptFile, setReceiptFile,
    isScanning, setIsScanning, dragOver, setDragOver, billFileRef,
    viewJournal, setViewJournal, journalDate, setJournalDate,
    journalSource, setJournalSource, journalRef, setJournalRef,
    coaSearch, setCoaSearch, coaTypeFilter, setCoaTypeFilter,
    showAccountForm, setShowAccountForm, editAccountId, setEditAccountId,
    accountForm, setAccountForm,
    glAccount, setGlAccount, glDateFrom, setGlDateFrom, glDateTo, setGlDateTo,
    plPartner, setPlPartner, plDateFrom, setPlDateFrom, plDateTo, setPlDateTo,
    hdr,
  }

  if (!mounted) return <ModuleSkeleton />

  return (
    <AccountingProvider value={ctxValue as any}>
      <div className="mod-page finance-workspace finance-workspace--accounts" data-finance-tab={tab}>
        <ModuleHeader
          title={financeHeader[tab].title}
          subtitle={financeHeader[tab].subtitle}
          subtitleMode="visible"
          icon={<Fa icon={faBook} />}
          color="var(--success)"
          className="!min-h-0 !py-2 sm:!py-2.5"
          primaryAction={
            (tab === 'invoices' || tab === 'bills') ? (
              <PrimaryActionButton
                icon={<Fa icon={faPlus} />}
                onClick={() => {
                  setEditingInvId(null)
                  setNewPaymentDetails({ ...DEFAULT_DOCUMENT_PAYMENT_DETAILS })
                  setShowNewForm(true)
                }}
              >
                {tab === 'invoices' ? 'New invoice' : 'New bill'}
              </PrimaryActionButton>
            ) : tab === 'coa' ? (
              <PrimaryActionButton
                icon={<Fa icon={faPlus} />}
                onClick={() => {
                  const type = coaTypeFilter === 'all' ? 'asset' : coaTypeFilter
                  const prefix =
                    type === 'asset' ? '2'
                    : type === 'liability' ? '3'
                    : type === 'equity' ? '4'
                    : type === 'revenue' ? '5'
                    : '6'
                  const nums = accounts
                    .map(a => a.code)
                    .filter(c => c.startsWith(prefix) && /^\d+$/.test(c))
                    .map(c => Number(c))
                    .filter(n => Number.isFinite(n))
                  const code = String(nums.length ? Math.max(...nums) + 1 : Number(`${prefix}001`))
                  setAccountForm({
                    code,
                    name: '',
                    type,
                    group: type === 'asset' ? 'Cash at Bank' : '',
                    subGroup: '',
                    isActive: true,
                    balance: 0,
                    notes: '',
                  })
                  setEditAccountId(null)
                  setShowAccountForm(true)
                }}
              >
                New account
              </PrimaryActionButton>
            ) : undefined
          }
        />

        {/* KPI strip and workflow alerts removed — AR/AP, cash position, and
            finance exceptions now live on the central dashboard */}

        <div className="border-b border-border-lt bg-card">
          <TabBar
            tabs={FINANCE_SECTIONS.map(section => ({ id: section.id, label: section.label }))}
            active={FINANCE_TAB_SECTION[tab] || 'overview'}
            onChange={id => {
              const section = FINANCE_SECTIONS.find(item => item.id === id)
              if (section) setTab(section.defaultTab)
            }}
            maxVisibleMobile={3}
            maxVisibleTablet={6}
            maxVisibleDesktop={6}
            ariaLabel="Finance workspaces"
          />
          {(FINANCE_TAB_SECTION[tab] || 'overview') !== 'overview' && (
            <div className="px-3 pb-2">
              <TabBar
                tabs={FINANCE_SECTION_TABS[FINANCE_TAB_SECTION[tab] || 'overview']}
                active={tab}
                onChange={id => setTab(id as MainTab)}
                className="border-0 bg-transparent px-0 py-0"
                maxVisibleMobile={3}
                maxVisibleTablet={5}
                maxVisibleDesktop={6}
                ariaLabel="Finance workspace sections"
              />
            </div>
          )}
        </div>

        <div className="mod-body finance-workspace__body">
        {tab === 'reports' && (
          <div className="finance-report-command mb-3 space-y-2">
            <div className="finance-report-tabs rounded-xl border border-border-lt bg-card p-2 space-y-2">
              <div>
                <div className="px-1 pb-1 text-xs font-semibold text-text-3">Management reports</div>
                <TabBar
                  tabs={REPORT_TABS.filter(t => MANAGEMENT_REPORT_IDS.has(t.id)).map(t => ({ id: t.id, label: t.label }))}
                  active={reportTab}
                  onChange={id => setReport(id as ReportTab)}
                  className="border-0 px-0 py-0 bg-transparent"
                  maxVisibleMobile={3}
                  maxVisibleTablet={5}
                  maxVisibleDesktop={5}
                  ariaLabel="Management reports"
                />
              </div>
              <details className="border-t border-border-lt pt-2">
                <summary className="px-1 text-xs font-semibold text-text-3 cursor-pointer">Compliance & detailed reports</summary>
                <TabBar
                  tabs={REPORT_TABS.filter(t => CONTROL_REPORT_IDS.has(t.id)).map(t => ({ id: t.id, label: t.label }))}
                  active={reportTab}
                  onChange={id => setReport(id as ReportTab)}
                  className="border-0 px-0 pt-2 pb-0 bg-transparent"
                  maxVisibleMobile={3}
                  maxVisibleTablet={5}
                  maxVisibleDesktop={5}
                  ariaLabel="Compliance and detailed reports"
                />
              </details>
            </div>
            {journalSot && (
              <details className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
                <summary className="cursor-pointer font-semibold text-[var(--text-2)]">Report data status</summary>
                <div
                  className={`finance-sot-notice mt-2 rounded-lg border px-3 py-2 text-xs ${
                  journalSot.certified
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    : 'border-amber-200 bg-amber-50 text-amber-950'
                }`}
                role="status"
              >
                {journalSot.certified ? (
                  <>
                    Report SoT: Prisma GL journals <strong>certified</strong>
                    {journalSot.certifiedAt
                      ? ` (${new Date(journalSot.certifiedAt).toLocaleDateString('en-KE')})`
                      : ''}.
                    {journalSot.retireReady
                      ? ' Live blob key is retire-ready (Director cutover API).'
                      : ' Live blob key is not retire-ready while store still writes journals.'}
                  </>
                ) : (
                  <>
                    Report SoT: Prisma GL is <strong>provisional</strong> until{' '}
                    <code className="text-[11px]">deed_journalEntries</code> is certified
                    {journalSot.coveragePct != null
                      ? ` (ref coverage ${Math.round(journalSot.coveragePct * 100)}%)`
                      : ''}
                    . Certify from Settings → Data Cutover after verify.
                  </>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
        {/* ── Tab Content ────────────────────────────────────────────────────── */}
        {tab === 'dashboard' ? (
          <AccountingDashboard onNavigate={target => setTab(target as MainTab)} />
        ) : (
        <div className={`card overflow-hidden rounded-xl finance-content-card finance-subcomponent-shell finance-content-card--${tab}`}>
          {tab === 'integrity' ? (
            <IntegrityDashboard />
          ) : tab === 'invoices' || tab === 'bills' ? (
            <div className="flex flex-col">
              <DataTable
                tableId={`finance-${tab}-list-v4`}
                columns={([
                  {
                    key: 'number', label: 'Number', priority: 1 as const, width: '118px',
                    render: (i: Invoice) => <span className="text-xs font-bold text-primary-600 erp-truncate" title={displayDocRef(i.ref)}>{displayDocRef(i.ref)}</span>,
                    accessor: (i: Invoice) => displayDocRef(i.ref),
                  },
                  {
                    key: 'partner', label: tab === 'invoices' ? 'Customer' : 'Vendor', priority: 1 as const, width: 'minmax(12rem, 2fr)',
                    render: (i: Invoice) => <span className="text-xs font-semibold text-[var(--text-1)] erp-truncate" title={i.partnerName}>{i.partnerName}</span>,
                    accessor: (i: Invoice) => i.partnerName,
                  },
                  {
                    key: 'document_date', label: tab === 'invoices' ? 'Invoice Date' : 'Bill Date', priority: 1 as const, width: '108px',
                    render: (i: Invoice) => <span className="text-xs text-[var(--text-3)] tabular-nums">{fmtDate(i.date)}</span>,
                    exportValue: (i: Invoice) => i.date,
                  },
                  {
                    key: 'accounting_date', label: 'Accounting Date', priority: 3 as const, width: '118px',
                    render: (i: Invoice) => <span className="text-xs text-[var(--text-3)] tabular-nums">{i.postedAt ? fmtDate(i.postedAt.slice(0, 10)) : '—'}</span>,
                    exportValue: (i: Invoice) => i.postedAt?.slice(0, 10) || '',
                  },
                  {
                    key: 'due', label: 'Due Date', priority: 2 as const, width: '104px',
                    render: (i: Invoice) => <span className="text-xs text-[var(--text-3)] tabular-nums">{fmtDate(i.dueDate)}</span>,
                    exportValue: (i: Invoice) => i.dueDate ?? '',
                  },
                  {
                    key: 'reference', label: 'Reference', priority: 2 as const, width: '120px',
                    render: (i: Invoice) => {
                      const reference = sourceReferenceForInvoice(i)
                      return <span className="text-xs font-mono text-[var(--text-2)] erp-truncate" title={reference}>{reference}</span>
                    },
                    accessor: (i: Invoice) => sourceReferenceForInvoice(i),
                  },
                  {
                    key: 'salesperson', label: tab === 'invoices' ? 'Salesperson' : 'Responsible', priority: 3 as const, width: '130px',
                    render: (i: Invoice) => <span className="text-xs text-[var(--text-2)] erp-truncate" title={i.salespersonName || i.postedByName || ''}>{i.salespersonName || i.postedByName || '—'}</span>,
                    accessor: (i: Invoice) => i.salespersonName || i.postedByName || '',
                  },
                  {
                    key: 'activities', label: 'Activities', priority: 3 as const, width: '90px', align: 'center' as const,
                    render: (i: Invoice) => {
                      const count = (i.payments || []).length + (i.notes?.trim() ? 1 : 0)
                      return <span className={count > 0 ? 'badge badge-blue text-[10px]' : 'badge badge-gray text-[10px]'}>{count > 0 ? count + ' update' + (count === 1 ? '' : 's') : 'None'}</span>
                    },
                    exportValue: (i: Invoice) => (i.payments || []).length + (i.notes?.trim() ? 1 : 0),
                  },
                  {
                    key: 'untaxed', label: 'Untaxed Amount', priority: 2 as const, width: '118px', align: 'right' as const,
                    render: (i: Invoice) => <span className="text-xs tabular-nums text-[var(--text-2)]">{fmtKes(i.subtotal)}</span>,
                    exportValue: (i: Invoice) => i.subtotal,
                    footer: (pageRows: Invoice[]) => <span className="text-xs font-bold tabular-nums">{fmtKes(pageRows.reduce((sum, invoice) => sum + invoice.subtotal, 0))}</span>,
                  },
                  {
                    key: 'tax', label: 'Tax', priority: 2 as const, width: '100px', align: 'right' as const,
                    render: (i: Invoice) => <span className="text-xs tabular-nums text-[var(--text-2)]">{i.taxTotal > 0 ? fmtKes(i.taxTotal) : '—'}</span>,
                    exportValue: (i: Invoice) => i.taxTotal,
                    footer: (pageRows: Invoice[]) => <span className="text-xs font-bold tabular-nums">{fmtKes(pageRows.reduce((sum, invoice) => sum + invoice.taxTotal, 0))}</span>,
                  },
                  {
                    key: 'total', label: 'Total', priority: 1 as const, width: '112px', align: 'right' as const,
                    render: (i: Invoice) => <span className="text-xs font-bold text-[var(--text-1)] tabular-nums">{fmtKes(i.total)}</span>,
                    exportValue: (i: Invoice) => i.total,
                    footer: (pageRows: Invoice[]) => <span className="text-xs font-bold tabular-nums">{fmtKes(pageRows.reduce((sum, invoice) => sum + invoice.total, 0))}</span>,
                  },
                  {
                    key: 'currency_total', label: 'Document Currency', priority: 3 as const, width: '138px', align: 'right' as const,
                    render: (i: Invoice) => <span className="text-xs font-medium text-[var(--text-2)] tabular-nums whitespace-nowrap">{documentCurrencyAmount(i, i.total)}</span>,
                    exportValue: (i: Invoice) => (i.currencyCode || companySettings.currency || 'KES') + ' ' + i.total,
                  },
                  {
                    key: 'balance', label: 'Amount Due', priority: 1 as const, width: '112px', align: 'right' as const,
                    render: (i: Invoice) => {
                      const balance = Math.max(0, i.total - i.amountPaid)
                      return <span className={'text-xs font-bold tabular-nums ' + (balance > 0 ? 'text-red-500' : 'text-emerald-600')}>{balance > 0 ? fmtKes(balance) : 'Settled'}</span>
                    },
                    exportValue: (i: Invoice) => Math.max(0, i.total - i.amountPaid),
                    footer: (pageRows: Invoice[]) => <span className="text-xs font-bold tabular-nums">{fmtKes(pageRows.reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.amountPaid), 0))}</span>,
                  },
                  {
                    key: 'payment_status', label: 'Payment Status', priority: 1 as const, width: '132px',
                    render: (i: Invoice) => {
                      const label = financeListPaymentStatusLabel(i)
                      if (label === 'Not available') return <Badge status="pending" label={label} />
                      const paymentState = invoicePaymentStatus(i)
                      return (
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          <Badge status={paymentState === 'paid' ? 'active' : paymentState === 'blocked' || paymentState === 'reversed' ? 'cancelled' : 'pending'} label={label} />
                          {isInvoiceOverdue(i) && <Badge status="cancelled" label="Overdue" />}
                        </span>
                      )
                    },
                    exportValue: (i: Invoice) => financeListPaymentStatusLabel(i),
                  },
                  {
                    key: 'status', label: 'Document Status', priority: 3 as const, width: '104px',
                    render: (i: Invoice) => {
                      const state = invoiceDocState(i.status)
                      return <Badge status={state === 'posted' ? 'active' : state === 'cancelled' ? 'cancelled' : 'pending'} label={INVOICE_DOC_STATE_LABELS[state]} />
                    },
                    exportValue: (i: Invoice) => INVOICE_DOC_STATE_LABELS[invoiceDocState(i.status)],
                  },
                ] satisfies ColumnDef<Invoice>[])}
                defaultVisibleColumnKeys={[
                  'number',
                  'partner',
                  'document_date',
                  'due',
                  'total',
                  'balance',
                  'payment_status',
                ]}
                minTableWidth={960}
                rows={filteredInvoices}
                rowKey={i => i.id}
                searchValue={invSearch}
                onSearchChange={value => { setInvSearch(value) }}
                searchPlaceholder={tab === 'invoices' ? 'Search invoice number or customer…' : 'Search bill number or vendor…'}
                clientSearch={false}
                page={invoiceListPage}
                onPageChange={setInvoiceListPage}
                primaryFilters={invoicePrimaryFilters}
                hideColumnFilters
                selectable
                emptyMessage={tab === 'invoices' ? 'No invoices found' : 'No bills found'}
                onRowClick={i => openInvoiceRecord(i.id)}
                rowLabel={i => `${displayDocRef(i.ref)} ${i.partnerName}`}
                cardAccent={i => Math.max(0, i.total - i.amountPaid) > 0 ? 'var(--danger)' : 'var(--success)'}
                renderCard={i => {
                  const balance = Math.max(0, i.total - i.amountPaid)
                  const pct = i.total > 0 ? Math.min(100, (i.amountPaid / i.total) * 100) : 0
                  const badge = invoiceBadge(i)
                  return (
                    <RecordCard
                      eyebrow={displayDocRef(i.ref)}
                      title={i.partnerName}
                      subtitle={`${fmtDate(i.date)} · due ${fmtDate(i.dueDate)}`}
                      amount={fmtKes(balance || i.total)}
                      status={<span className="inline-flex items-center gap-1"><Badge status={badge.status as any} label={badge.label} size="xs" />{badge.overdue && <Badge status="cancelled" label="Overdue" size="xs" />}</span>}
                      accent={balance > 0 ? 'var(--danger)' : 'var(--success)'}
                      meta={[
                        { label: 'Total', value: fmtKes(i.total) },
                        { label: 'Paid', value: fmtKes(i.amountPaid) },
                        { label: 'Paid %', value: `${Math.round(pct)}%` },
                      ]}
                      onClick={() => openInvoiceRecord(i.id)}
                    />
                  )
                }}
                bulkActions={({ rows, clear }) => {
                  const payable = rows.filter(b => invoiceDocState(b.status) === 'posted' && b.total > b.amountPaid)
                  const totalOutstanding = payable.reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0)
                  const bulkLabel = tab === 'invoices' ? 'Invoice' : 'Bill'
                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[var(--text-2)]">
                        {rows.length} selected
                        {payable.length > 0 ? ` · ${payable.length} payable · ${fmtKes(totalOutstanding)} outstanding` : ''}
                      </span>
                      <button type="button" className="btn-ghost text-xs" onClick={clear}>Clear</button>
                      <button
                        type="button"
                        className="btn-secondary text-xs flex items-center gap-1.5"
                        disabled={rows.length === 0 || bulkDownloading}
                        onClick={() => { void downloadSelectedInvoices(rows) }}
                      >
                        <Fa icon={faDownload} className="text-[10px]" />
                        {bulkDownloading ? 'Downloading…' : `Download PDF${rows.length !== 1 ? 's' : ''}`}
                      </button>
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={payable.length === 0}
                        onClick={() => {
                          setSelectedInvIds(new Set(payable.map(b => b.id)))
                          setPayAmount(String(totalOutstanding))
                          setShowBulkPayModal(true)
                        }}
                      >
                        {tab === 'invoices' ? 'Record receipt for' : 'Pay'} {payable.length} {bulkLabel.toLowerCase()}{payable.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  )
                }}
                exportTitle={tab === 'invoices' ? 'Customer invoices' : 'Vendor bills'}
                exportFilename={tab === 'invoices' ? 'customer-invoices' : 'vendor-bills'}
              />
            </div>
          ) : tab === 'refunds' ? (
            <div className="flex flex-col">
              <DataTable
                tableId="finance-refunds"
                columns={[
                  { key: 'ref', label: 'Ref', priority: 1, width: '110px', render: rp => <span className="font-mono text-xs font-semibold text-primary-600 erp-truncate" title={rp.ref}>{rp.ref}</span>, accessor: rp => rp.ref },
                  { key: 'date', label: 'Date', priority: 2, width: '110px', render: rp => <span className="text-xs tabular-nums">{rp.paymentDate}</span>, exportValue: rp => rp.paymentDate },
                  { key: 'rma', label: 'RMA', priority: 2, width: '110px', render: rp => <span className="text-xs text-[var(--text-2)] erp-truncate" title={rp.rmaRef}>{rp.rmaRef}</span>, accessor: rp => rp.rmaRef },
                  { key: 'customer', label: 'Customer', priority: 1, width: 'minmax(12rem, 1.4fr)', render: rp => <span className="text-sm font-medium erp-truncate" title={rp.customerName}>{rp.customerName}</span>, accessor: rp => rp.customerName },
                  { key: 'amount', label: 'Amount', priority: 1, width: '120px', align: 'right', render: rp => <span className="text-sm font-semibold text-red-500 tabular-nums">{fmtKes(rp.amount)}</span>, exportValue: rp => rp.amount },
                  {
                    key: 'method', label: 'Method', priority: 3, width: '120px',
                    render: rp => (
                      <span className={`chip text-xs ${rp.paymentMethod === 'cash' ? 'chip-yellow' : rp.paymentMethod === 'mpesa' ? 'chip-green' : 'chip-blue'}`}>
                        {rp.paymentMethod === 'mpesa' ? 'M-Pesa' : rp.paymentMethod === 'bank_transfer' ? 'Bank transfer' : 'Cash'}
                      </span>
                    ),
                    exportValue: rp => rp.paymentMethod,
                  },
                  { key: 'notes', label: 'Notes', priority: 3, width: '1fr', render: rp => <span className="text-xs text-[var(--text-3)] truncate">{rp.notes ?? '—'}</span>, exportValue: rp => rp.notes ?? '' },
                ]}
                rows={refundPayments}
                rowKey={rp => rp.id}
                emptyMessage="No refunds recorded"
                searchPlaceholder="Search refunds…"
                exportTitle="Refund payments"
                exportFilename="refunds"
              />
            </div>
          ) : tab === 'credits' ? (
            <div className="finance-subview finance-subview--credits"><CustomerCreditsTab /></div>
          ) : tab === 'commissions' ? (
            <div className="finance-subview finance-subview--commissions"><CommissionsTab /></div>
          ) : tab === 'journals' ? (
            <div className="finance-subview finance-subview--journals"><JournalsTab /></div>
          ) : tab === 'coa' ? (
            <div className="finance-subview finance-subview--coa"><ChartOfAccountsTab /></div>
          ) : tab === 'gl' ? (
            <div className="finance-subview finance-subview--ledger"><GeneralLedgerTab /></div>
          ) : tab === 'partner_ledger' ? (
            <div className="finance-subview finance-subview--partner-ledger"><PartnerLedgerTab /></div>
          ) : tab === 'migration' ? (
            <div className="finance-subview finance-subview--migration p-4 sm:p-6 space-y-5">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-[10px] uppercase tracking-widest font-black text-blue-700">Old system migration</p>
                <h2 className="text-base font-extrabold text-blue-950 mt-1">Import contacts, invoices, bills, and opening balances</h2>
                <p className="text-xs text-blue-800 mt-2 max-w-3xl">
                  Each spreadsheet row creates or reuses a contact. If an opening balance is supplied, it becomes a posted customer invoice
                  for receivables or a posted vendor bill for payables.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl border border-border-lt bg-card p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-text-1">Spreadsheet columns</h3>
                    <p className="text-xs text-text-3 mt-1">Required: Kind, Name. Optional: Email, Phone, Address, VAT Number, Opening Balance, Reference, Date, Due Date, Notes.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-surface border border-border-lt p-3">
                      <p className="font-bold text-text-1">Kind = customer</p>
                      <p className="text-text-3 mt-1">Creates a customer contact. Opening Balance becomes a posted customer invoice.</p>
                    </div>
                    <div className="rounded-xl bg-surface border border-border-lt p-3">
                      <p className="font-bold text-text-1">Kind = vendor / supplier</p>
                      <p className="text-text-3 mt-1">Creates a supplier contact. Opening Balance becomes a posted vendor bill.</p>
                    </div>
                  </div>
                  {migrationSummary && (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-800">{migrationSummary}</div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button className="btn-secondary" onClick={downloadMigrationTemplate}>Download template</button>
                    <button className="btn-primary" disabled={migrationImporting} onClick={() => migrationFileRef.current?.click()}>
                      {migrationImporting ? 'Importing...' : 'Upload migration file'}
                    </button>
                    <input
                      ref={migrationFileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={event => handleMigrationFile(event.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="font-extrabold mb-2">Before importing</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Clean duplicate customer/supplier names in the old app export.</li>
                    <li>Use positive balances only; payments can be recorded after import.</li>
                    <li>Put old document numbers in Reference for traceability.</li>
                    <li>Import a small sample first if the file is large.</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : activeTab === 'financial_report' ? (
            <div className="finance-subview finance-subview--financial-report"><FinancialReportTab /></div>
          ) : activeTab === 'monthly' ? (
            <div className="p-4 sm:p-6 space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-1)]">Monthly Management Report</h2>
                  <p className="text-xs text-[var(--text-3)] mt-1">
                    Operational estimate from invoices / POS / expenses. Official books: Accounting → P&amp;L (Prisma).
                  </p>
                  <p className="text-xs text-[var(--text-3)] mt-1">Sales by category, estimated profit, expenses, supplier bills, and collections.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <Field label="Report Month">
                    <Select value={monthlyReportMonth} onChange={setMonthlyReportMonth} options={reportMonthOptions.map(value => ({ value, label: monthLabel(value) }))} />
                  </Field>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary flex items-center gap-2"
                      onClick={() => { void exportToExcel(
                        `Monthly Management Report — ${monthlyReport.label}`,
                        ['Metric', 'Amount'],
                        [
                          ['Total Revenue', monthlyReport.totalRevenue],
                          ['Invoice Revenue', monthlyReport.invoiceRevenue],
                          ['POS Revenue', monthlyReport.posRevenue],
                          ['Repair Revenue', monthlyReport.repairRevenue],
                          ['Estimated Cost', monthlyReport.estimatedCost],
                          ['Gross Profit', monthlyReport.grossProfit],
                          ['Operating Expenses', monthlyReport.operatingExpenses],
                          ['Supplier Bills', monthlyReport.supplierBills],
                          ['Net Profit', monthlyReport.netProfit],
                          ['Cash Collected', monthlyReport.cashCollected],
                        ],
                        `Monthly_Report_${monthlyReport.month}`,
                      ) }}
                    >
                      <Fa icon={faDownload} /> Export
                    </button>
                    <button className="btn-secondary flex items-center gap-2" onClick={() => window.print()}><Fa icon={faPrint} /> Print</button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="card p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Revenue Mix</p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span>Invoices</span><span className="font-mono font-bold">{fmtKes(monthlyReport.invoiceRevenue)}</span></div>
                    <div className="flex justify-between"><span>POS Sales</span><span className="font-mono font-bold">{fmtKes(monthlyReport.posRevenue)}</span></div>
                    <div className="flex justify-between"><span>Repairs</span><span className="font-mono font-bold">{fmtKes(monthlyReport.repairRevenue)}</span></div>
                  </div>
                </div>
                <div className="card p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Margin</p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span>Revenue</span><span className="font-mono font-bold">{fmtKes(monthlyReport.totalRevenue)}</span></div>
                    <div className="flex justify-between"><span>Estimated COGS</span><span className="font-mono font-bold text-red-600">{fmtKes(monthlyReport.estimatedCost)}</span></div>
                    <div className="flex justify-between border-t pt-2 border-[var(--border-lt)]"><span>Gross Margin</span><span className="font-mono font-black">{monthlyReport.totalRevenue > 0 ? `${Math.round((monthlyReport.grossProfit / monthlyReport.totalRevenue) * 100)}%` : '—'}</span></div>
                  </div>
                </div>
                <div className="card p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Activity</p>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span>Invoices</span><span className="font-mono font-bold">{monthlyReport.invoicesCount}</span></div>
                    <div className="flex justify-between"><span>POS Transactions</span><span className="font-mono font-bold">{monthlyReport.posCount}</span></div>
                    <div className="flex justify-between"><span>Expense Claims</span><span className="font-mono font-bold">{monthlyReport.expensesCount}</span></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[var(--text-1)]">Sales by Product Category</h3>
                    <span className="text-xs font-bold text-[var(--text-3)]">{monthlyReport.categorySummary.length} categories</span>
                  </div>
                  <DataTable
                    tableId="finance-monthly-categories"
                    hideSearch
                    perPage={50}
                    emptyMessage="No sales recorded for this month"
                    rowKey={row => row.category}
                    rows={monthlyReport.categorySummary}
                    columns={[
                      { key: 'category', label: 'Category', priority: 1, width: '1.4fr', render: row => <span className="font-semibold">{row.category}</span>, accessor: row => row.category },
                      { key: 'qty', label: 'Qty sold', priority: 2, width: '100px', align: 'right', render: row => <span className="font-mono">{row.qty}</span>, exportValue: row => row.qty },
                      { key: 'revenue', label: 'Revenue', priority: 1, width: '120px', align: 'right', render: row => <span className="font-mono">{fmtKes(row.revenue)}</span>, exportValue: row => row.revenue },
                      { key: 'profit', label: 'Est. profit', priority: 2, width: '120px', align: 'right', render: row => <span className={`font-mono font-bold ${row.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtKes(row.profit)}</span>, exportValue: row => row.profit },
                    ]}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[var(--text-1)]">Expenses by Category</h3>
                    <span className="text-xs font-bold text-[var(--text-3)]">{monthlyReport.expenseSummary.length} categories</span>
                  </div>
                  <DataTable
                    tableId="finance-monthly-expenses"
                    hideSearch
                    perPage={50}
                    emptyMessage="No expenses recorded for this month"
                    rowKey={row => String(row.category)}
                    rows={[
                      ...monthlyReport.expenseSummary,
                      { category: 'supplier_bills', count: 0, amount: monthlyReport.supplierBills },
                    ]}
                    columns={[
                      {
                        key: 'category', label: 'Expense category', priority: 1, width: '1.4fr',
                        render: row => <span className={`font-semibold capitalize ${row.category === 'supplier_bills' ? 'font-bold' : ''}`}>{String(row.category).replace(/_/g, ' ')}</span>,
                        accessor: row => String(row.category).replace(/_/g, ' '),
                      },
                      { key: 'count', label: 'Claims', priority: 2, width: '90px', align: 'right', render: row => <span className="font-mono">{row.category === 'supplier_bills' ? '—' : row.count}</span>, exportValue: row => row.count },
                      { key: 'amount', label: 'Amount', priority: 1, width: '120px', align: 'right', render: row => <span className="font-mono font-bold">{fmtKes(row.amount)}</span>, exportValue: row => row.amount },
                    ]}
                  />
                </div>
              </div>
            </div>
          ) : activeTab === 'pl' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-1)]">Profit & Loss Statement</h2>
                  <p className="text-xs text-[var(--text-3)]">
                    {plSource === 'prisma'
                      ? 'Official management P&L: KES from posted Prisma journal lines (revenue → COGS → gross → opex/finance → net).'
                      : 'Legacy blob estimate from invoices, bills, and expenses — not official books.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {plSource === 'prisma' && (
                    <>
                      <label className="text-[11px] text-[var(--text-3)] flex items-center gap-1">
                        From
                        <input
                          type="date"
                          className="form-input text-[11px] py-1.5"
                          value={pnlDateFrom}
                          onChange={e => setPnlDateFrom(e.target.value)}
                          aria-label="P&L date from"
                        />
                      </label>
                      <label className="text-[11px] text-[var(--text-3)] flex items-center gap-1">
                        To
                        <input
                          type="date"
                          className="form-input text-[11px] py-1.5"
                          value={pnlDateTo}
                          onChange={e => setPnlDateTo(e.target.value)}
                          aria-label="P&L date to"
                        />
                      </label>
                    </>
                  )}
                  <select
                    className="form-select text-[11px] py-1.5"
                    value={plSource}
                    onChange={e => setPlSource(e.target.value as 'blob' | 'prisma')}
                    aria-label="P&L source"
                  >
                    <option value="prisma">Official: Prisma (KES posted)</option>
                    <option value="blob">Legacy: client blob</option>
                  </select>
                  <button className="btn-secondary flex items-center gap-2" onClick={() => {
                    const pl = prismaReports.profitLoss
                    const rev = plSource === 'prisma'
                      ? (pl?.totalIncome ?? pl?.totalRevenue ?? 0)
                      : customerInvoices.reduce((s, i) => s + i.subtotal, 0)
                    const cogs = plSource === 'prisma'
                      ? (pl?.totalCogs ?? 0)
                      : vendorBills.reduce((s, i) => s + i.subtotal, 0)
                    const opex = plSource === 'prisma'
                      ? ((pl?.totalOperating ?? 0) + (pl?.totalFinance ?? 0))
                      : expenses.reduce((s, e) => s + e.amount, 0)
                    const net = plSource === 'prisma'
                      ? (pl?.netProfit ?? 0)
                      : rev - cogs - opex
                    exportToPDF(
                      'Profit & Loss Statement',
                      ['Category', 'Amount (KES)'],
                      plSource === 'prisma'
                        ? [
                            ['Total Income', fmtKes(rev)],
                            ['Cost of Goods Sold', fmtKes(cogs)],
                            ['Gross Profit', fmtKes(pl?.grossProfit ?? rev - cogs)],
                            ['Operating Expenses', fmtKes(pl?.totalOperating ?? 0)],
                            ['Finance Costs', fmtKes(pl?.totalFinance ?? 0)],
                            ['Net Profit', fmtKes(net)],
                          ]
                        : [
                            ['Total Revenue', fmtKes(rev)],
                            ['Cost of Goods Sold', fmtKes(cogs)],
                            ['Gross Profit', fmtKes(rev - cogs)],
                            ['Operating Expenses', fmtKes(opex)],
                            ['Net Profit', fmtKes(net)],
                          ],
                      `PL_Statement_${new Date().toISOString().slice(0, 10)}`
                    )
                  }}>
                    <Fa icon={faDownload} />
                    <span>Download PDF</span>
                  </button>
                  <button className="btn-secondary flex items-center gap-2" onClick={() => window.print()}>
                    <Fa icon={faPrint} />
                    <span>Print</span>
                  </button>
                </div>
              </div>
              <div className="max-w-2xl mx-auto">
                {plSource === 'prisma' ? (
                  prismaReports.loading ? (
                    <p className="text-sm text-[var(--text-3)]">Loading Prisma P&L…</p>
                  ) : (
                    (() => {
                      const pl = prismaReports.profitLoss
                      const isMgmt = pl?.view === 'management' || Boolean(pl?.cogs)
                      if (!isMgmt) {
                        return (
                          <>
                            <PLSection title="Revenue">
                              {(pl?.revenue ?? []).map(r => (
                                <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                              ))}
                              <PLRow label="Total Revenue" amount={pl?.totalRevenue ?? 0} bold />
                            </PLSection>
                            <PLSection title="Expenses" className="mt-6">
                              {(pl?.expenses ?? []).map(r => (
                                <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                              ))}
                              <PLRow label="Total Expenses" amount={pl?.totalExpenses ?? 0} bold />
                            </PLSection>
                            <PLRow label="Net Profit" amount={pl?.netProfit ?? 0} bold />
                          </>
                        )
                      }
                      return (
                        <>
                          <PLSection title="Revenue">
                            {(pl?.revenue ?? []).map(r => (
                              <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                            ))}
                            <PLRow label="Total Revenue" amount={pl?.totalRevenue ?? 0} bold />
                          </PLSection>
                          {(pl?.otherIncome?.length ?? 0) > 0 && (
                            <PLSection title="Other Income" className="mt-6">
                              {(pl?.otherIncome ?? []).map(r => (
                                <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                              ))}
                              <PLRow label="Total Other Income" amount={pl?.totalOtherIncome ?? 0} bold />
                            </PLSection>
                          )}
                          <PLRow label="Total Income" amount={pl?.totalIncome ?? pl?.totalRevenue ?? 0} bold />
                          <PLSection title="Cost of Goods Sold" className="mt-6">
                            {(pl?.cogs ?? []).map(r => (
                              <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                            ))}
                            <PLRow label="Total COGS" amount={pl?.totalCogs ?? 0} bold />
                          </PLSection>
                          <PLRow label="Gross Profit" amount={pl?.grossProfit ?? 0} bold />
                          <PLSection title="Operating Expenses" className="mt-6">
                            {(pl?.operatingExpenses ?? []).map(r => (
                              <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                            ))}
                            <PLRow label="Total Operating" amount={pl?.totalOperating ?? 0} bold />
                          </PLSection>
                          {(pl?.financeCosts?.length ?? 0) > 0 && (
                            <PLSection title="Finance Costs" className="mt-6">
                              {(pl?.financeCosts ?? []).map(r => (
                                <PLRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                              ))}
                              <PLRow label="Total Finance Costs" amount={pl?.totalFinance ?? 0} bold />
                            </PLSection>
                          )}
                          <PLRow label="Net Profit" amount={pl?.netProfit ?? 0} bold />
                          {pl?.dateFrom || pl?.dateTo ? (
                            <p className="text-[11px] text-[var(--text-3)] mt-4">
                              Period: {pl?.dateFrom || '…'} → {pl?.dateTo || '…'}
                            </p>
                          ) : null}
                        </>
                      )
                    })()
                  )
                ) : (
                  (() => {
                    const rev = customerInvoices.reduce((s, i) => s + i.subtotal, 0)
                    const cogs = vendorBills.reduce((s, i) => s + i.subtotal, 0)
                    const opex = expenses.reduce((s, e) => s + e.amount, 0)
                    const net = rev - cogs - opex
                    return (
                      <>
                        <PLSection title="Revenue">
                          <PLRow label="Total Revenue (from Invoices)" amount={rev} />
                        </PLSection>
                        <PLSection title="Cost of Goods Sold">
                          <PLRow label="Total Purchases (from Bills)" amount={cogs} />
                        </PLSection>
                        <PLRow label="Gross Profit" amount={rev - cogs} bold />
                        <PLSection title="Expenses" className="mt-6">
                          <PLRow label="Operating Expenses (from Expenses)" amount={opex} />
                        </PLSection>
                        <PLRow label="Net Profit" amount={net} bold />
                      </>
                    )
                  })()
                )}
              </div>
            </div>
          ) : activeTab === 'bs' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-1)]">Balance Sheet</h2>
                  <p className="text-xs text-[var(--text-3)]">
                    {bsSource === 'prisma'
                      ? 'Official SoT: KES-only from posted Prisma journal lines through today.'
                      : 'Legacy blob estimate from cashbook and open invoices/bills — not official books.'}
                  </p>
                </div>
                <select
                  className="form-select text-[11px] py-1.5"
                  value={bsSource}
                  onChange={e => setBsSource(e.target.value as 'blob' | 'prisma')}
                  aria-label="Balance sheet source"
                >
                  <option value="prisma">Official: Prisma (KES posted)</option>
                  <option value="blob">Legacy: client blob</option>
                </select>
              </div>
              {bsSource === 'prisma' ? (
                prismaReports.loading ? (
                  <p className="text-sm text-[var(--text-3)]">Loading Prisma balance sheet…</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div>
                      <BSSection title="Assets" />
                      <BSSectionSub title="Posted balances">
                        {(prismaReports.balanceSheet?.assets ?? []).map(r => (
                          <BSRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                        ))}
                        <BSRow label="Total Assets" amount={prismaReports.balanceSheet?.totalAssets ?? 0} bold />
                      </BSSectionSub>
                    </div>
                    <div>
                      <BSSection title="Liabilities & Equity" />
                      <BSSectionSub title="Liabilities">
                        {(prismaReports.balanceSheet?.liabilities ?? []).map(r => (
                          <BSRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                        ))}
                        <BSRow label="Total Liabilities" amount={prismaReports.balanceSheet?.totalLiabilities ?? 0} bold />
                      </BSSectionSub>
                      <BSSectionSub title="Equity">
                        {(prismaReports.balanceSheet?.equity ?? []).map(r => (
                          <BSRow key={r.code} label={`${r.code} — ${r.name}`} amount={r.amount} />
                        ))}
                        <BSRow label="Total Equity" amount={prismaReports.balanceSheet?.totalEquity ?? 0} bold />
                      </BSSectionSub>
                    </div>
                  </div>
                )
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div>
                    <BSSection title="Assets" />
                    <BSSectionSub title="Current Assets">
                      <BSRow label="Cash at Bank" amount={cashAtBankBS} />
                      <BSRow label="Cash in Hand" amount={cashInHandBS} />
                      <BSRow label="Accounts Receivable" amount={outstandingAR} />
                    </BSSectionSub>
                  </div>
                  <div>
                    <BSSection title="Liabilities & Equity" />
                    <BSSectionSub title="Current Liabilities">
                      <BSRow label="Accounts Payable" amount={outstandingAP} />
                    </BSSectionSub>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'vat' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-1)]">VAT Control Report</h2>
                  <p className="text-xs text-[var(--text-3)]">
                    {vatSource === 'prisma'
                      ? 'Official SoT: output VAT (3301) less input VAT (1150) from posted Prisma journal lines.'
                      : 'Legacy: sums taxTotal on posted blob sales invoices and vendor bills.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="form-select text-[11px] py-1.5"
                    value={vatSource}
                    onChange={e => setVatSource(e.target.value as 'blob' | 'prisma')}
                    aria-label="VAT report source"
                  >
                    <option value="prisma">Prisma GL</option>
                    <option value="blob">Blob invoices</option>
                  </select>
                  <button
                    className="btn-secondary flex items-center gap-2"
                    onClick={() => {
                      const vat = vatSource === 'prisma' && prismaReports.vatControl
                        ? {
                            taxableSales: prismaReports.vatControl.taxableSales ?? 0,
                            outputVat: prismaReports.vatControl.outputVat,
                            taxablePurchases: prismaReports.vatControl.taxablePurchases ?? 0,
                            inputVat: prismaReports.vatControl.inputVat,
                            vatPayable: prismaReports.vatControl.vatPayable,
                          }
                        : financeReports.vat
                      void exportToExcel(
                        'VAT Control Report',
                        ['Metric', 'Amount'],
                        [
                          ['Taxable Sales', vat.taxableSales],
                          ['Output VAT', vat.outputVat],
                          ['Taxable Purchases', vat.taxablePurchases],
                          ['Input VAT', vat.inputVat],
                          ['Net VAT Payable/(Refundable)', vat.vatPayable],
                        ],
                        `VAT_Report_${new Date().toISOString().slice(0, 10)}`,
                      )
                    }}
                  >
                    <Fa icon={faDownload} /> Export
                  </button>
                </div>
              </div>
              {vatSource === 'prisma' && prismaReports.loading ? (
                <p className="text-sm text-[var(--text-3)]">Loading VAT control from journals…</p>
              ) : vatSource === 'prisma' && prismaReports.error ? (
                <p className="text-sm text-[var(--danger)]">{prismaReports.error}</p>
              ) : (
                <DataTable
                  tableId="finance-vat-report"
                  hideSearch
                  perPage={20}
                  rowKey={row => row.metric}
                  rows={(() => {
                    const vat = vatSource === 'prisma' && prismaReports.vatControl
                      ? {
                          taxableSales: prismaReports.vatControl.taxableSales,
                          outputVat: prismaReports.vatControl.outputVat,
                          taxablePurchases: prismaReports.vatControl.taxablePurchases,
                          inputVat: prismaReports.vatControl.inputVat,
                          vatPayable: prismaReports.vatControl.vatPayable,
                        }
                      : financeReports.vat
                    const rows = [
                      ...(vat.taxableSales != null ? [{ metric: 'Taxable sales', amount: vat.taxableSales }] : []),
                      { metric: 'Output VAT', amount: vat.outputVat },
                      ...(vat.taxablePurchases != null ? [{ metric: 'Taxable purchases', amount: vat.taxablePurchases }] : []),
                      { metric: 'Input VAT', amount: vat.inputVat },
                      { metric: 'Net VAT payable / refundable', amount: vat.vatPayable },
                    ]
                    return rows
                  })()}
                  columns={[
                    { key: 'metric', label: 'Metric', priority: 1, width: '2fr', render: row => <span className={row.metric.startsWith('Net') ? 'font-bold' : ''}>{row.metric}</span>, accessor: row => row.metric },
                    { key: 'amount', label: 'Amount', priority: 1, width: '160px', align: 'right', render: row => <span className={`font-mono ${row.metric.startsWith('Net') ? 'font-bold' : ''}`}>{fmtKes(row.amount)}</span>, exportValue: row => row.amount },
                  ]}
                  exportTitle="VAT control report"
                  exportFilename="vat-report"
                />
              )}
            </div>
          ) : activeTab === 'ageing' ? (
            <div className="finance-subview finance-subview--ageing"><AgeingTab customerInvoices={customerInvoices} vendorBills={vendorBills} /></div>
          ) : activeTab === 'trial_balance' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-1)]">Trial balance</h2>
                  <p className="text-xs text-[var(--text-3)]">
                    {tbSource === 'prisma'
                      ? 'Official SoT: KES-only from posted Prisma journal lines (no FX, no seed balances).'
                      : 'Legacy blob journals and opening balances — not official books.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="form-select text-[11px] py-1.5"
                    value={tbSource}
                    onChange={e => setTbSource(e.target.value as 'blob' | 'prisma')}
                    aria-label="Trial balance source"
                  >
                    <option value="prisma">Official: Prisma (KES posted)</option>
                    <option value="blob">Legacy: client blob</option>
                  </select>
                  <span className={`badge ${(tbSource === 'prisma' ? prismaReports.trialBalance?.balanced : Math.abs(financeReports.tbTotals.debit - financeReports.tbTotals.credit) < 0.01) ? 'badge-green' : 'badge-red'}`}>
                    {(tbSource === 'prisma' ? prismaReports.trialBalance?.balanced : Math.abs(financeReports.tbTotals.debit - financeReports.tbTotals.credit) < 0.01) ? 'Balanced' : 'Out of balance'}
                  </span>
                </div>
              </div>
              <DataTable
                tableId="finance-trial-balance"
                hideSearch
                perPage={100}
                emptyMessage={tbSource === 'prisma' ? (prismaReports.loading ? 'Loading…' : 'No posted Prisma journal lines yet') : 'No trial balance rows'}
                rowKey={row => row.id}
                rows={[
                  ...(tbSource === 'prisma'
                    ? (prismaReports.trialBalance?.rows ?? [])
                    : financeReports.trialBalance),
                  {
                    id: '__totals__',
                    code: '',
                    name: 'Totals',
                    type: '',
                    debit: tbSource === 'prisma'
                      ? (prismaReports.trialBalance?.totals.debit ?? 0)
                      : financeReports.tbTotals.debit,
                    credit: tbSource === 'prisma'
                      ? (prismaReports.trialBalance?.totals.credit ?? 0)
                      : financeReports.tbTotals.credit,
                  },
                ]}
                columns={[
                  { key: 'code', label: 'Code', priority: 1, width: '100px', render: row => <span className="font-mono text-xs">{row.code || '—'}</span>, accessor: row => row.code },
                  { key: 'name', label: 'Account', priority: 1, width: '1.6fr', render: row => <span className={row.id === '__totals__' ? 'font-bold' : ''}>{row.name}</span>, accessor: row => row.name },
                  { key: 'type', label: 'Type', priority: 2, width: '110px', render: row => <span className="capitalize text-xs">{row.type || '—'}</span>, accessor: row => row.type },
                  { key: 'debit', label: 'Debit', priority: 1, width: '120px', align: 'right', render: row => <span className={`font-mono ${row.id === '__totals__' ? 'font-bold' : ''}`}>{row.debit ? fmtKes(row.debit) : '—'}</span>, exportValue: row => row.debit || 0 },
                  { key: 'credit', label: 'Credit', priority: 1, width: '120px', align: 'right', render: row => <span className={`font-mono ${row.id === '__totals__' ? 'font-bold' : ''}`}>{row.credit ? fmtKes(row.credit) : '—'}</span>, exportValue: row => row.credit || 0 },
                ]}
                exportTitle="Trial balance"
                exportFilename="trial-balance"
              />
            </div>
          ) : activeTab === 'cash_flow' ? (
            <CashFlowPanel />
          ) : activeTab === 'cash_position' ? (
            <div className="p-6">
              <h2 className="text-lg font-bold text-[var(--text-1)] mb-5">Cash position</h2>
              <DataTable
                tableId="finance-cash-position"
                hideSearch
                perPage={50}
                emptyMessage="No cash accounts"
                rowKey={row => row.id}
                rows={[
                  ...financeReports.cashPosition,
                  {
                    id: '__totals__',
                    name: 'Total cash',
                    bankName: '',
                    active: true,
                    opening: financeReports.cashTotals.opening,
                    inflows: financeReports.cashTotals.inflows,
                    outflows: financeReports.cashTotals.outflows,
                    balance: financeReports.cashTotals.balance,
                  },
                ]}
                columns={[
                  { key: 'account', label: 'Account', priority: 1, width: '1.4fr', render: row => <span className={row.id === '__totals__' ? 'font-bold' : 'font-semibold'}>{row.name}</span>, accessor: row => row.name },
                  { key: 'bank', label: 'Bank', priority: 2, width: '1fr', render: row => <span className="text-xs text-[var(--text-3)]">{row.bankName || (row.id === '__totals__' ? '—' : (row.active ? 'Active cash account' : 'Inactive'))}</span>, accessor: row => row.bankName || '' },
                  { key: 'opening', label: 'Opening', priority: 2, width: '120px', align: 'right', render: row => <span className="font-mono">{fmtKes(row.opening)}</span>, exportValue: row => row.opening },
                  { key: 'inflows', label: 'Inflows', priority: 2, width: '120px', align: 'right', render: row => <span className="font-mono text-emerald-600">{fmtKes(row.inflows)}</span>, exportValue: row => row.inflows },
                  { key: 'outflows', label: 'Outflows', priority: 2, width: '120px', align: 'right', render: row => <span className="font-mono text-red-500">{fmtKes(row.outflows)}</span>, exportValue: row => row.outflows },
                  { key: 'balance', label: 'Balance', priority: 1, width: '120px', align: 'right', render: row => <span className={`font-mono ${row.id === '__totals__' ? 'font-bold' : 'font-bold'}`}>{fmtKes(row.balance)}</span>, exportValue: row => row.balance },
                ]}
                exportTitle="Cash position"
                exportFilename="cash-position"
              />
            </div>
          ) : activeTab === 'fx' ? (
            <FxRevaluationPanel showToast={showToast} />
          ) : (
            <div className="finance-subview finance-subview--cashbook"><CashbookTab accounts={accounts} /></div>
          )}
        </div>
        )}

        {/* ── BULK PAYMENT MODAL ── */}
        {showBulkPayModal && (() => {
          const selItems = filteredInvoices.filter(b => selectedInvIds.has(b.id))
          const totalOutstanding = selItems.reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0)
          const activeBanks = bankAccounts.filter(a => a.active)
          const bulkLabel = tab === 'invoices' ? 'Invoice' : 'Bill'
          const bulkPartnerLabel = tab === 'invoices' ? 'Customer' : 'Vendor'
          return (
            <Modal title={`${tab === 'invoices' ? 'Record receipt for' : 'Pay'} ${selItems.length} ${bulkLabel}${selItems.length !== 1 ? 's' : ''}`} subtitle={`Balance to clear: ${fmtKes(totalOutstanding)}`} onClose={() => setShowBulkPayModal(false)} width={500}>
              <div className="finance-payment-dialog flex flex-col gap-4">
                {/* Item list */}
                <div className="rounded-xl border border-[var(--border-lt)] overflow-hidden">
                  <div className="bg-[var(--bg-surface)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] grid grid-cols-3 gap-2">
                    <span>{bulkLabel}</span><span>{bulkPartnerLabel}</span><span className="text-right">Balance</span>
                  </div>
                  <div className="divide-y divide-[var(--border-lt)] max-h-48 overflow-y-auto custom-scrollbar">
                    {selItems.map(b => (
                      <div key={b.id} className="px-3 py-2 grid grid-cols-3 gap-2 items-center">
                        <span className="text-xs font-bold text-primary-600 font-mono">{b.ref}</span>
                        <span className="text-xs text-[var(--text-2)] truncate">{b.partnerName}</span>
                        <span className="text-xs font-bold text-red-500 text-right font-mono">{fmtKes(Math.max(0, b.total - b.amountPaid))}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-3 py-2 bg-[var(--bg-surface)] flex justify-between border-t border-[var(--border-lt)]">
                    <span className="text-xs font-black text-[var(--text-1)]">Total</span>
                    <span className="text-xs font-black text-red-500 font-mono">{fmtKes(totalOutstanding)}</span>
                  </div>
                </div>

                <Field label="Payment Date">
                  <Input type="date" value={payDate} onChange={setPayDate} />
                </Field>
                <Field label="Payment Method">
                  <Select value={payMethod} onChange={setPayMethod} options={[
                    { value: 'mpesa', label: 'M-Pesa' },
                    { value: 'bank_transfer', label: 'Bank Transfer' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'card', label: 'Card' },
                    { value: 'cheque', label: 'Cheque' },
                  ]} />
                </Field>
                {activeBanks.length > 0 && (
                  <Field label={tab === 'invoices' ? 'Bank / Account Received Into' : 'Bank / Account Paid From'}>
                    <Select value={payBankAccountId} onChange={setPayBankAccountId} options={[
                      { value: '', label: tab === 'invoices' ? '— Select receiving account —' : '— Select paying account —' },
                      ...activeBanks.map(b => ({ value: b.id, label: b.bankName || b.id }))
                    ]} />
                  </Field>
                )}
                <Field label="Reference / Transaction ID">
                  <Input value={payReference} onChange={setPayReference} placeholder="M-Pesa code, bank ref, cheque no..." />
                </Field>

                <div className="flex gap-2 justify-end pt-2">
                  <button className="btn-outline" onClick={() => setShowBulkPayModal(false)}>Cancel</button>
                  <button
                    className="btn-primary"
                    style={{ background: 'var(--primary)' }}
                    onClick={() => {
                      if (payMethod === 'bank_transfer' && !payBankAccountId) {
                        showToast('Select a bank account for bank transfer payments', 'error')
                        return
                      }
                      selItems.forEach(b => {
                        const bal = Math.max(0, b.total - b.amountPaid)
                        if (bal > 0) registerPayment(b.id, bal, payMethod, payBankAccountId || undefined, payReference, payDate)
                      })
                      setShowBulkPayModal(false)
                      setSelectedInvIds(new Set())
                      setPayReference('')
                      setPayBankAccountId('')
                      setPayMethod('mpesa')
                      showToast(`${selItems.length} payment${selItems.length !== 1 ? 's' : ''} recorded successfully`, 'success')
                    }}
                  >
                    {tab === 'invoices' ? 'Confirm Receipt' : 'Confirm Payment'} — {fmtKes(totalOutstanding)}
                  </button>
                </div>
              </div>
            </Modal>
          )
        })()}

        {showNewForm && (
          <Modal
            title={editingInvId ? `Edit ${tab === 'bills' ? 'Bill' : 'Invoice'}` : (tab === 'bills' ? 'New Vendor Bill' : 'New Invoice')}
            onClose={() => resetInvForm()}
            width={980}
          >
            <div className="finance-document-editor flex flex-col min-h-[560px]">
              <div className="finance-document-editor__intro p-4 -mx-6 -mt-6 mb-6 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-primary-600">
                    {tab === 'bills' ? 'Accounts Payable' : 'Accounts Receivable'}
                  </p>
                  <h3 className="text-sm font-extrabold text-[var(--text-1)] mt-1">
                    {editingInvId ? 'Revise draft document' : (tab === 'bills' ? 'Create supplier bill' : 'Create customer invoice')}
                  </h3>
                  <p className="text-[11px] text-[var(--text-4)] mt-0.5">Add a partner, due date, and valid charge lines before saving.</p>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${newPartnerId ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className={`w-2 h-2 rounded-full ${invoicePreview.invalidLineIndexes.length === 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className={`w-2 h-2 rounded-full ${invoicePreview.total > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                </div>
              </div>

              <div className="flex flex-col gap-6">
              <div className="finance-document-editor__meta grid grid-cols-1 lg:grid-cols-4 gap-4">
                {editingInvId && newPartnerId && !changingPartner ? (
                  <div className="lg:col-span-2">
                  <Field label={tab === 'bills' ? 'Vendor *' : 'Customer *'}>
                    <div className="form-input flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--text-1)]">{newPartnerName}</span>
                      <button
                        type="button"
                        className="text-[10px] text-[var(--accent)] hover:underline ml-2 cursor-pointer"
                        onClick={() => setChangingPartner(true)}
                      >
                        Change
                      </button>
                    </div>
                  </Field>
                  </div>
                ) : (
                  <div className="lg:col-span-2">
                  <SearchPicker
                    label={tab === 'bills' ? 'Vendor *' : 'Customer *'}
                    placeholder={tab === 'bills' ? 'Search vendor...' : 'Search customer...'}
                    items={tab === 'bills' ? vendors : customers}
                    onSelect={c => {
                      setNewPartnerId(c.id)
                      setNewPartnerName((c as any).name)
                      setChangingPartner(false)
                    }}
                    onCreateNew={q => {
                      setCreatePartnerSeed(q.trim())
                      setCreatePartnerKey(k => k + 1)
                      setShowCreatePartner(true)
                    }}
                    createNewLabels={{
                      title: tab === 'bills' ? 'Create vendor' : 'Create customer',
                      subtitle: 'Open the full Contacts form',
                    }}
                    renderItem={c => (
                      <div>
                        <p className="font-bold text-xs">{(c as any).name}</p>
                        <p className="text-[10px] text-[var(--text-4)]">{(c as any).email ?? ''}</p>
                      </div>
                    )}
                  />
                  </div>
                )}
                <Field label="Document Date">
                  <input
                    type="date"
                    className="form-input text-xs"
                    value={newDocumentDate}
                    onChange={e => setNewDocumentDate(e.target.value)}
                  />
                </Field>
                <Field label="Due Date">
                  <input
                    type="date"
                    className="form-input text-xs"
                    value={newDueDate}
                    onChange={e => setNewDueDate(e.target.value)}
                  />
                </Field>
                <div className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-4)]">Status</p>
                  <p className="text-xs font-black text-[var(--text-1)] mt-1">Draft</p>
                  <p className="text-[10px] text-[var(--text-4)] mt-0.5">Confirm after review.</p>
                </div>
              </div>

              {newPartnerId && (
                <div className="finance-document-editor__partner rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-black text-emerald-700">
                      Selected {tab === 'bills' ? 'vendor' : 'customer'}
                    </p>
                    <p className="text-sm font-extrabold text-emerald-950 mt-0.5">{newPartnerName}</p>
                  </div>
                  {!editingInvId && (
                    <button
                      type="button"
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer"
                      onClick={() => {
                        setNewPartnerId('')
                        setNewPartnerName('')
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              <div className="finance-document-editor__lines flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-1)]">Line Items</h4>
                    <p className="text-[10px] text-[var(--text-4)] mt-0.5">Use positive quantity and price for every line.</p>
                  </div>
                  <span className="text-[10px] font-bold text-[var(--text-4)]">{newLines.length} line{newLines.length === 1 ? '' : 's'}</span>
                </div>
                <div className="border border-[var(--border-lt)] rounded-2xl overflow-hidden">
                  <div className="dt-scroll">
                    <table data-no-responsive className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-20">Qty</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-28">Unit Price</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-20">Disc%</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-20">Tax</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-32">Line Total</th>
                          <th className="px-3 py-2.5 w-28"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-lt)]">
                        {newLines.map((l, i) => {
                          const previewLine = invoicePreview.lines[i]
                          const isInvalid = invoicePreview.invalidLineIndexes.includes(i)
                          const moveButtons = (
                            <>
                              <button
                                type="button"
                                onClick={() => moveNewLine(i, -1)}
                                disabled={i === 0}
                                aria-label={`Move line ${i + 1} up`}
                                className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Fa icon={faArrowUp} className="text-[9px]" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveNewLine(i, 1)}
                                disabled={i === newLines.length - 1}
                                aria-label={`Move line ${i + 1} down`}
                                className="icon-btn disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Fa icon={faArrowDown} className="text-[9px]" aria-hidden="true" />
                              </button>
                            </>
                          )
                          if (l.type === 'section') {
                            return (
                              <tr key={i} className={`transition-colors ${isInvalid ? 'bg-red-50/60' : 'bg-slate-50/70'}`}>
                                <td className="px-3 py-2" colSpan={5}>
                                  <input
                                    className="form-input text-xs w-full font-bold"
                                    placeholder="Section title, e.g. Hardware, Services, Accessories"
                                    value={l.desc}
                                    onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
                                  />
                                  {isInvalid && !l.desc.trim() && <p className="text-[9px] text-red-600 font-semibold mt-1">Section title required</p>}
                                </td>
                                <td className="px-3 py-2 text-right text-[10px] font-bold text-[var(--text-4)]">Section</td>
                                <td className="px-3 py-2 text-center">
                                  <div className="flex items-center justify-end gap-0.5">
                                    {moveButtons}
                                    <button
                                      type="button"
                                      onClick={() => setNewLines(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
                                      disabled={newLines.length === 1}
                                      className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                                      aria-label={`Remove section ${i + 1}`}
                                    >
                                      <Fa icon={faTrash} className="text-[9px]" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          }
                          return (
                            <tr key={i} className={`transition-colors ${isInvalid ? 'bg-red-50/60' : 'hover:bg-[var(--bg-surface)]/40'}`}>
                              <td className="px-3 py-2">
                                <input
                                  className="form-input text-xs w-full"
                                  placeholder={tab === 'bills' ? 'Supplier charge description...' : 'Service or product description...'}
                                  value={l.desc}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
                                />
                                {isInvalid && !l.desc.trim() && <p className="text-[9px] text-red-600 font-semibold mt-1">Description required</p>}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={1}
                                  className="form-input text-xs text-center w-16"
                                  value={l.qty}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                                />
                                {isInvalid && Number(l.qty) <= 0 && <p className="text-[9px] text-red-600 font-semibold mt-1 text-center">Qty &gt; 0</p>}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  className="form-input text-xs text-right w-28"
                                  value={l.price}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                                />
                                {isInvalid && Number(l.price) <= 0 && <p className="text-[9px] text-red-600 font-semibold mt-1 text-right">Price &gt; 0</p>}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  aria-label={`Discount percent for line ${i + 1}`}
                                  className="form-input text-xs text-center w-16"
                                  value={l.discount}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, discount: e.target.value } : x)))}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  className="form-select text-xs w-16"
                                  value={applyVat ? String(invoiceVatRate) : l.tax}
                                  disabled={applyVat}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, tax: e.target.value } : x)))}
                                >
                                  <option value="0">0%</option>
                                  <option value={String(invoiceVatRate)}>{invoiceVatRate}%</option>
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <p className="text-xs font-black text-[var(--text-1)] font-mono">{fmtKes(previewLine?.total ?? 0)}</p>
                                {(previewLine?.discountAmount ?? 0) > 0 && (
                                  <p className="text-[9px] text-amber-700 mt-0.5">Disc {fmtKes(previewLine?.discountAmount ?? 0)}</p>
                                )}
                                {previewLine?.taxAmount ? <p className="text-[9px] text-[var(--text-4)] mt-0.5">Incl. tax {fmtKes(previewLine.taxAmount)}</p> : null}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <div className="flex items-center justify-end gap-0.5">
                                  {moveButtons}
                                  <button
                                    type="button"
                                    onClick={() => setNewLines(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
                                    disabled={newLines.length === 1}
                                    className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                                    aria-label={`Remove line ${i + 1}`}
                                  >
                                    <Fa icon={faTrash} className="text-[9px]" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2.5 border-t border-[var(--border-lt)] bg-[var(--bg-surface)]">
                    <div className="flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={() => setNewLines(p => [...p, newManualInvoiceLine()])}
                        className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold cursor-pointer"
                      >
                        <Fa icon={faPlus} className="text-[10px]" /> Add a line
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewLines(p => [...p, newManualSectionLine()])}
                        className="flex items-center gap-2 text-xs text-slate-600 hover:underline font-semibold cursor-pointer"
                      >
                        <Fa icon={faPlus} className="text-[10px]" /> Add a section
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="finance-document-editor__support-grid grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="finance-document-editor__support flex flex-col gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-4 py-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded"
                      checked={applyVat}
                      onChange={e => setApplyVat(e.target.checked)}
                    />
                    <span className="text-xs font-bold text-[var(--text-2)]">
                      Apply VAT to all lines ({invoiceVatRate}%)
                    </span>
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-3)]">Notes / Terms</label>
                    <textarea
                      className="form-input text-xs"
                      rows={4}
                      placeholder={tab === 'bills' ? 'Supplier reference, payment terms, or internal notes...' : 'Payment terms, delivery notes, or customer instructions...'}
                      value={newNotes}
                      onChange={e => setNewNotes(e.target.value)}
                    />
                    <p className="text-[10px] text-[var(--text-4)]">Shown on the document detail and carried into PDF notes.</p>
                  </div>
                  {tab === 'invoices' && (
                    <PaymentDetailsPicker
                      value={newPaymentDetails}
                      onChange={setNewPaymentDetails}
                      bankAccounts={bankAccounts}
                      isVat={applyVat || newLines.some(l => Number(l.tax) > 0)}
                    />
                  )}
                </div>

                <div className="finance-document-editor__summary card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold text-[var(--text-2)]">Summary</h4>
                    <Badge status={invoicePreview.canSave ? 'paid' : 'warning'} label={invoicePreview.canSave ? 'Ready' : 'Incomplete'} />
                  </div>
                  <div className="flex flex-col gap-3">
                    {(invoicePreview.discountTotal ?? 0) > 0 ? (
                      <>
                        <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(invoicePreview.grossTotal)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Discount</span><span className="font-bold text-amber-700">−{fmtKes(invoicePreview.discountTotal)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Net</span><span className="font-bold">{fmtKes(invoicePreview.subtotal)}</span></div>
                      </>
                    ) : (
                      <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(invoicePreview.subtotal)}</span></div>
                    )}
                    <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">VAT / Tax</span><span className="font-bold">{fmtKes(invoicePreview.taxTotal)}</span></div>
                    <div className="border-t border-[var(--border-lt)] pt-3 flex justify-between text-sm"><span className="font-bold text-[var(--text-1)]">Total</span><span className="font-extrabold text-primary-600">{fmtKes(invoicePreview.total)}</span></div>
                  </div>
                  {invoicePreview.blockedReason && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[10px] font-bold text-amber-700">{invoicePreview.blockedReason}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="finance-document-editor__footer flex items-center justify-between pt-4 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs cursor-pointer" onClick={() => resetInvForm()}>Discard</button>
                <button
                  className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={createDocument}
                  disabled={!invoicePreview.canSave}
                >
                  <Fa icon={faFileInvoiceDollar} />
                  <span>{editingInvId ? 'Save Changes' : (tab === 'bills' ? 'Create Bill' : 'Create Invoice')}</span>
                </button>
              </div>
              </div>
            </div>
          </Modal>
        )}

        {showCreatePartner && (
          <ContactFormModal
            key={createPartnerKey}
            forceCustomer={tab !== 'bills'}
            forceVendor={tab === 'bills'}
            initial={tab === 'bills'
              ? blankCompanyContact({
                  name: createPartnerSeed,
                  isCustomer: false,
                  isVendor: true,
                })
              : blankIndividualContact({ name: createPartnerSeed })}
            onClose={() => {
              setShowCreatePartner(false)
              setCreatePartnerSeed('')
            }}
            onSaved={(contact) => {
              setNewPartnerId(contact.id)
              setNewPartnerName(contact.name)
              setChangingPartner(false)
              setShowCreatePartner(false)
              setCreatePartnerSeed('')
            }}
          />
        )}

        {showCreatePartner && (
          <ContactFormModal
            key={createPartnerKey}
            forceCustomer={tab !== 'bills'}
            forceVendor={tab === 'bills'}
            initial={tab === 'bills'
              ? blankCompanyContact({
                  name: createPartnerSeed,
                  isCustomer: false,
                  isVendor: true,
                })
              : blankIndividualContact({ name: createPartnerSeed })}
            onClose={() => {
              setShowCreatePartner(false)
              setCreatePartnerSeed('')
            }}
            onSaved={(contact) => {
              setNewPartnerId(contact.id)
              setNewPartnerName(contact.name)
              setChangingPartner(false)
              setShowCreatePartner(false)
              setCreatePartnerSeed('')
            }}
          />
        )}

        </div>{/* mod-body */}
      </div>
    </AccountingProvider>
  )
}

// ── P&L sub-components ────────────────────────────────────────────────────────
function PLSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-6 ${className || ''}`}>
      <p className="text-[10px] uppercase tracking-widest font-bold mb-3 text-[var(--text-4)]">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}
function PLRow({
  label,
  amount,
  bold,
  indent,
}: {
  label: string
  amount: number
  bold?: boolean
  indent?: boolean
}) {
  return (
    <div
      className={`
        flex justify-between items-center py-2 px-3 rounded-xl transition-colors
        ${bold ? 'bg-[var(--bg-surface)] border border-[var(--border-lt)]' : 'hover:bg-[var(--bg-surface)]'}
      `}
      style={{ paddingLeft: indent ? 24 : 12 }}
    >
      <span className={`text-xs ${bold ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
        {label}
      </span>
      <span className={`font-mono text-xs ${bold ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}>
        {fmtKes(amount)}
      </span>
    </div>
  )
}

// ── Balance Sheet sub-components ──────────────────────────────────────────────
function BSSection({ title }: { title: string }) {
  return (
    <p className="text-xs uppercase tracking-widest font-extrabold mt-6 mb-3 text-primary-600">
      {title}
    </p>
  )
}
function BSSectionSub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="text-[10px] uppercase tracking-widest font-bold mb-3 text-[var(--text-4)]">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}
function FxRevaluationPanel({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [balanceAccountLabel, setBalanceAccountLabel] = useState('1800 - Accounts Receivable')
  const [amountBase, setAmountBase] = useState('')
  const [amountForeign, setAmountForeign] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/accounting/fx-revaluation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: ref.trim(),
          date,
          balanceAccountLabel: balanceAccountLabel.trim(),
          amountBase: Number(amountBase),
          amountForeign: Number(amountForeign),
          rate: Number(rate),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      if (data.skipped) showToast('No FX difference — journal skipped', 'info')
      else showToast('FX revaluation journal posted', 'success')
    } catch (err: any) {
      showToast(err?.message || 'FX revaluation failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-lg font-bold text-[var(--text-1)] mb-1">FX month-end revaluation</h2>
      <p className="text-xs text-[var(--text-3)] mb-5">
        Posts a Prisma gain/loss journal when foreign × rate differs from booked KES base. Official books only.
      </p>
      <div className="space-y-3">
        <Field label="Reference">
          <Input value={ref} onChange={setRef} placeholder="AR-USD-2026-08" />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={setDate} />
        </Field>
        <Field label="Balance account">
          <Input value={balanceAccountLabel} onChange={setBalanceAccountLabel} placeholder="1800 - Accounts Receivable" />
        </Field>
        <Field label="Booked amount (KES base)">
          <Input type="number" value={amountBase} onChange={setAmountBase} />
        </Field>
        <Field label="Foreign amount">
          <Input type="number" value={amountForeign} onChange={setAmountForeign} />
        </Field>
        <Field label="Closing rate (foreign → KES)">
          <Input type="number" value={rate} onChange={setRate} />
        </Field>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Posting…' : 'Post FX revaluation'}
        </button>
      </div>
    </div>
  )
}

function BSRow({
  label,
  amount,
  bold,
  indent,
  code,
  negative,
}: {
  label: string
  amount: number
  bold?: boolean
  indent?: boolean
  code?: string
  negative?: boolean
}) {
  return (
    <div
      className={`
        flex justify-between items-center py-2 px-3 rounded-xl transition-colors
        ${bold ? 'bg-[var(--bg-surface)] border border-[var(--border-lt)]' : 'hover:bg-[var(--bg-surface)]'}
      `}
      style={{ paddingLeft: indent ? 24 : 12 }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {code && !bold && <span className="text-[9px] font-mono text-[var(--text-4)] shrink-0">{code}</span>}
        <span className={`text-xs truncate ${bold ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
          {label}
        </span>
      </div>
      <span
        className={`font-mono text-xs shrink-0 ${bold ? 'font-bold' : ''}`}
        style={{ color: negative ? 'var(--danger)' : bold ? 'var(--text-1)' : 'var(--text-3)' }}
      >
        {negative ? `(${fmtKes(Math.abs(amount))})` : fmtKes(amount)}
      </span>
    </div>
  )
}
