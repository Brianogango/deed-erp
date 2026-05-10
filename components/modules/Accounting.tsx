'use client'

import { useMemo, useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
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
  faPencil,
  faFileInvoiceDollar,
} from '@fortawesome/free-solid-svg-icons'

import {
  useApp,
  Invoice,
  InvoiceLine,
  JournalEntry,
  RefundPayment,
  Account,
  fmtKes,
  fmtDate,
} from '@/lib/store'
import { downloadPdf, printPdf, PdfLine } from '@/lib/pdf'
import { CO } from '@/lib/company'
import { exportToPDF, exportToExcel, type ExportRow } from '@/lib/export-utils'
import { generateInvoicesHtml } from './invoice-pdf'
import {
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Confirm,
  StatCard,
  PanelHeader,
  Divider,
  SearchPicker,
  ExportButtons,
  ModuleSkeleton,
  TabContent,
} from '@/components/ui'
import { Fa } from '@/components/icons'
import CashbookTab, { buildCashbookEntries } from './Cashbook'
import { AccountingProvider } from './accounting/AccountingContext'
import JournalsTab from './accounting/JournalsTab'
import ChartOfAccountsTab from './accounting/ChartOfAccountsTab'
import GeneralLedgerTab from './accounting/GeneralLedgerTab'
import PartnerLedgerTab from './accounting/PartnerLedgerTab'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

type MainTab =
  | 'invoices'
  | 'bills'
  | 'journals'
  | 'refunds'
  | 'coa'
  | 'gl'
  | 'partner_ledger'
  | 'pl'
  | 'bs'
  | 'cashbook'

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

const uid = () => Math.random().toString(36).slice(2, 9)
const today = () => new Date().toISOString().slice(0, 10)
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
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const appState = useApp()
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
    showToast,
    accounts,
    addAccount,
    updateAccount,
    bankAccounts,
    posOrders,
    expenses,
    payrollRuns,
    purchaseOrders,
    companySettings,
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
        { invoices, posOrders, expenses, payrollRuns, purchaseOrders },
        accounts
      ),
    [invoices, posOrders, expenses, payrollRuns, purchaseOrders, accounts]
  )
  const cashbookTotals = useMemo(() => {
    const map: Record<string, number> = {}
    for (const acc of bankAccounts) map[acc.id] = acc.openingBalance
    for (const e of allCashbookEntries) {
      if (map[e.bankAccountId] !== undefined) {
        map[e.bankAccountId] += e.credit - e.debit
      }
    }
    return map
  }, [allCashbookEntries, bankAccounts])
  // Cash at Bank = NCBA + Equity + KCB (bank accounts)
  const cashAtBankBS =
    (cashbookTotals['ncba'] ?? 0) + (cashbookTotals['equity'] ?? 0) + (cashbookTotals['kcb'] ?? 0)
  // Cash in Hand = Petty Cash + M-Pesa
  const cashInHandBS = (cashbookTotals['cash'] ?? 0) + (cashbookTotals['mpesa'] ?? 0)

  const defaultTab: MainTab = 'invoices'
  const queryTab = searchParams.get('tab') as MainTab | null
  const initialTab = queryTab ?? defaultTab

  const [tab, setLocalTab] = useState<MainTab>(initialTab)

  const setTab = (newTab: MainTab) => {
    setLocalTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlTab = searchParams.get('tab') as MainTab | null
    if (urlTab && urlTab !== tab) {
      setLocalTab(urlTab)
    }
  }, [searchParams, tab])

  // ── Invoice / Bill state ────────────────────────────────────────────────────
  const [invFilter, setInvFilter] = useState('all')
  const [invSearch, setInvSearch] = useState('')
  const [viewInv, setViewInv] = useState<Invoice | null>(null)
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(new Set())
  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('mpesa')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payReference, setPayReference] = useState('')
  const [delId, setDelId] = useState<string | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingInvId, setEditingInvId] = useState<string | null>(null)
  const [newPartnerId, setNewPartnerId] = useState('')
  const [newPartnerName, setNewPartnerName] = useState('')
  const [newDueDate, setNewDueDate] = useState(addDays(today(), 30))
  const [newLines, setNewLines] = useState([{ desc: '', qty: '1', price: '', tax: '0' }])
  const [applyVat, setApplyVat] = useState(false)
  const [localInvoices, setLocalInvoices] = useState<Invoice[]>([])

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const billFileRef = useRef<HTMLInputElement>(null)

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

  // ── Derived data ────────────────────────────────────────────────────────────
  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const canViewJournals = !!currentUser && ['admin', 'finance'].includes(currentUser?.role ?? '')
  const canManageFinance = !!currentUser && ['admin', 'finance'].includes(currentUser?.role ?? '')
  const customers = contacts.filter(c => c.isCustomer)
  const vendors = contacts.filter(c => c.isVendor)

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
      if (i.type === 'customer_invoice') {
        cust.push(i)
        revDyn += i.subtotal
        if (i.status === 'posted' || i.status === 'overdue') {
          outAR += i.total - i.amountPaid
        }
      } else if (i.type === 'vendor_bill') {
        vend.push(i)
        if (i.status === 'posted' || i.status === 'overdue') {
          outAP += i.total - i.amountPaid
        }
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
      let pass = false
      if (invFilter === 'all') pass = true
      else if (invFilter === 'unpaid') pass = i.status === 'posted' || i.status === 'overdue'
      else pass = i.status === invFilter

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

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handlePayment = () => {
    if (!viewInv || !payAmount) return
    registerPayment(viewInv.id, Number(payAmount), payMethod, payBankAccountId, payReference)
    setShowPayModal(false)
    setViewInv(null)
    showToast('Payment registered successfully', 'success')
  }

  const resetInvForm = () => {
    setShowNewForm(false)
    setEditingInvId(null)
    setNewPartnerId('')
    setNewPartnerName('')
    setNewLines([{ desc: '', qty: '1', price: '', tax: '0' }])
    setReceiptFile(null)
  }

  const handleBillFile = async (file: File | null) => {
    if (!file) return
    setReceiptFile(file)
    setIsScanning(true)
    // Simulate AI scan
    setTimeout(() => {
      setIsScanning(false)
      showToast('Bill scanned successfully', 'success')
    }, 1500)
  }

  const createDocument = () => {
    if (!newPartnerId || newLines.some(l => !l.desc || !l.price)) {
      showToast('Please fill all required fields', 'error')
      return
    }
    // Logic to create invoice/bill
    showToast(`${tab === 'invoices' ? 'Invoice' : 'Bill'} created`, 'success')
    resetInvForm()
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
    registerPayment, deleteInvoice, updateInvoice, postInvoice, addAccount, updateAccount, showToast,
    currentUser, canViewJournals, canManageFinance, customers, vendors,
    allInvoices, customerInvoices, vendorBills, outstandingAR, outstandingAP, totalRevenueDynamic,
    cashAtBankBS, cashInHandBS, allCashbookEntries, cashbookTotals,
    tab, setTab,
    invFilter, setInvFilter, invSearch, setInvSearch, viewInv, setViewInv,
    selectedInvIds, setSelectedInvIds, showPayModal, setShowPayModal,
    payAmount, setPayAmount, payMethod, setPayMethod,
    payBankAccountId, setPayBankAccountId, payReference, setPayReference,
    delId, setDelId, showNewForm, setShowNewForm, editingInvId, setEditingInvId,
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

  return (
    <AccountingProvider value={ctxValue as any}>
      <div className="flex flex-col gap-6 pb-10">
        {/* ── Header & Stats ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-[var(--text-1)]">Accounting & Finance</h1>
            <p className="text-xs text-[var(--text-3)]">Manage invoices, bills, and financial reports</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setTab('invoices')
                setShowNewForm(true)
              }}
              className="flex-1 sm:flex-none btn-primary flex items-center justify-center gap-2"
            >
              <Fa icon={faPlus} />
              <span>New Invoice</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Outstanding AR"
            value={fmtKes(outstandingAR)}
            sub="Unpaid customer invoices"
            color="#10B981"
            icon={<Fa icon={faArrowDown} />}
          />
          <StatCard
            label="Outstanding AP"
            value={fmtKes(outstandingAP)}
            sub="Unpaid vendor bills"
            color="#EF4444"
            icon={<Fa icon={faArrowUp} />}
          />
          <StatCard
            label="Cash at Bank"
            value={fmtKes(cashAtBankBS)}
            sub="Total in bank accounts"
            color="#3B82F6"
            icon={<Fa icon={faBook} />}
          />
          <StatCard
            label="Cash in Hand"
            value={fmtKes(cashInHandBS)}
            sub="Petty cash & M-Pesa"
            color="#8B5CF6"
            icon={<Fa icon={faMoneyBillWave} />}
          />
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {(
            [
              { id: 'invoices', label: 'Invoices', icon: faFileInvoiceDollar },
              { id: 'bills', label: 'Bills', icon: faArrowUp },
              { id: 'journals', label: 'Journals', icon: faBook },
              { id: 'coa', label: 'Accounts', icon: faListUl },
              { id: 'gl', label: 'Ledger', icon: faBalanceScale },
              { id: 'pl', label: 'P&L', icon: faChartLine },
              { id: 'bs', label: 'Balance Sheet', icon: faBalanceScale },
              { id: 'cashbook', label: 'Cashbook', icon: faMoneyBillWave },
            ] as const
          ).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap
                ${
                  tab === t.id
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                    : 'bg-white text-[var(--text-3)] hover:bg-[var(--bg-surface)] border border-[var(--border-lt)]'
                }
              `}
            >
              <Fa icon={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── Tab Content ────────────────────────────────────────────────────── */}
        <div className="card overflow-hidden">
          {tab === 'invoices' || tab === 'bills' ? (
            <div className="flex flex-col">
              <div className="p-4 border-b border-[var(--border-lt)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Search by number or partner..."
                      className="form-input pl-9"
                      value={invSearch}
                      onChange={e => setInvSearch(e.target.value)}
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]">
                      🔍
                    </div>
                  </div>
                  <select
                    className="form-select w-32"
                    value={invFilter}
                    onChange={e => setInvFilter(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="posted">Posted</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary flex items-center gap-2">
                    <Fa icon={faDownload} />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                        Number
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                        Partner
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                        Date
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                        Due
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-right">
                        Total
                      </th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-center">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-lt)]">
                    {filteredInvoices.map(i => (
                      <tr
                        key={i.id}
                        onClick={() => setViewInv(i)}
                        className="hover:bg-[var(--bg-surface)] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-xs font-bold text-primary-600">
                          {i.ref}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-1)]">
                          {i.partnerName}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-3)]">
                          {fmtDate(i.date)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-3)]">
                          {fmtDate(i.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-[var(--text-1)] text-right">
                          {fmtKes(i.total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            status={
                              i.status === 'paid'
                                ? 'active'
                                : i.status === 'overdue'
                                ? 'cancelled'
                                : 'pending'
                            }
                            label={i.status}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === 'journals' ? (
            <JournalsTab />
          ) : tab === 'coa' ? (
            <ChartOfAccountsTab />
          ) : tab === 'gl' ? (
            <GeneralLedgerTab />
          ) : tab === 'pl' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-[var(--text-1)]">Profit & Loss Statement</h2>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary flex items-center gap-2">
                    <Fa icon={faPrint} />
                    <span>Print</span>
                  </button>
                </div>
              </div>
              <div className="max-w-2xl mx-auto">
                <PLSection title="Revenue">
                  <PLRow label="Product Sales" amount={1250000} />
                  <PLRow label="Service Revenue" amount={450000} />
                  <PLRow label="Total Revenue" amount={1700000} bold />
                </PLSection>
                <PLSection title="Cost of Goods Sold">
                  <PLRow label="Opening Stock" amount={850000} />
                  <PLRow label="Purchases" amount={1100000} />
                  <PLRow label="Closing Stock" amount={950000} />
                  <PLRow label="Total COGS" amount={1000000} bold />
                </PLSection>
                <PLRow label="Gross Profit" amount={700000} bold />
              </div>
            </div>
          ) : tab === 'bs' ? (
            <div className="p-6">
              <h2 className="text-lg font-bold text-[var(--text-1)] mb-6">Balance Sheet</h2>
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
            </div>
          ) : (
            <CashbookTab accounts={accounts} />
          )}
        </div>

        {/* ── Modals ─────────────────────────────────────────────────────────── */}
        {viewInv && (
          <Modal
            title={`Invoice ${viewInv.ref}`}
            onClose={() => setViewInv(null)}
            width={720}
          >
            <div className="flex flex-col gap-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-[var(--text-4)] uppercase font-bold">Customer</p>
                  <p className="text-sm font-bold text-[var(--text-1)]">{viewInv.partnerName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[var(--text-4)] uppercase font-bold">Status</p>
                  <Badge
                    status={
                      viewInv.status === 'paid'
                        ? 'active'
                        : viewInv.status === 'overdue'
                        ? 'cancelled'
                        : 'pending'
                    }
                    label={viewInv.status}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 p-4 bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-lt)]">
                <div>
                  <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Date</p>
                  <p className="text-xs font-bold text-[var(--text-1)]">{fmtDate(viewInv.date)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Due Date</p>
                  <p className="text-xs font-bold text-[var(--text-1)]">{fmtDate(viewInv.dueDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[var(--text-4)] uppercase font-bold">Total Amount</p>
                  <p className="text-xs font-bold text-primary-600">{fmtKes(viewInv.total)}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary" onClick={() => setViewInv(null)}>Close</button>
                {viewInv.status !== 'paid' && (
                  <button className="btn-primary" onClick={() => setShowPayModal(true)}>Register Payment</button>
                )}
              </div>
            </div>
          </Modal>
        )}

        {showPayModal && (
          <Modal title="Register Payment" onClose={() => setShowPayModal(false)} width={400}>
            <div className="flex flex-col gap-4">
              <Field label="Amount to Pay">
                <Input
                  type="number"
                  value={payAmount}
                  onChange={setPayAmount}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Payment Method">
                <Select
                  value={payMethod}
                  onChange={setPayMethod}
                  options={[
                    { value: 'mpesa', label: '📱 M-Pesa' },
                    { value: 'bank', label: '🏦 Bank Transfer' },
                    { value: 'cash', label: '💵 Cash' },
                  ]}
                />
              </Field>
              <Field label="Reference">
                <Input
                  value={payReference}
                  onChange={setPayReference}
                  placeholder="Transaction ID"
                />
              </Field>
              <div className="flex gap-2 justify-end pt-2">
                <button className="btn-outline" onClick={() => setShowPayModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={handlePayment}>Confirm Payment</button>
              </div>
            </div>
          </Modal>
        )}

        {showNewForm && (
          <Modal
            title={editingInvId ? 'Edit Invoice' : 'New Invoice'}
            onClose={resetInvForm}
            width={800}
          >
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SearchPicker
                  label="Customer *"
                  placeholder="Search customer..."
                  items={customers}
                  onSelect={c => {
                    setNewPartnerId(c.id)
                    setNewPartnerName(c.name)
                  }}
                  renderItem={c => (
                    <div>
                      <p className="font-bold text-xs">{c.name}</p>
                      <p className="text-[10px] text-[var(--text-4)]">{c.email}</p>
                    </div>
                  )}
                />
                <Field label="Due Date">
                  <input
                    type="date"
                    className="form-input"
                    value={newDueDate}
                    onChange={e => setNewDueDate(e.target.value)}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-xs font-bold text-[var(--text-1)]">Line Items</p>
                <div className="flex flex-col gap-2">
                  {newLines.map((l, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-2 p-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-lt)]">
                      <div className="flex-1">
                        <Input
                          placeholder="Description"
                          value={l.desc}
                          onChange={v => setNewLines(p => p.map((x, j) => (j === i ? { ...x, desc: v } : x)))}
                        />
                      </div>
                      <div className="w-full sm:w-20">
                        <Input
                          type="number"
                          placeholder="Qty"
                          value={l.qty}
                          onChange={v => setNewLines(p => p.map((x, j) => (j === i ? { ...x, qty: v } : x)))}
                        />
                      </div>
                      <div className="w-full sm:w-32">
                        <Input
                          type="number"
                          placeholder="Price"
                          value={l.price}
                          onChange={v => setNewLines(p => p.map((x, j) => (j === i ? { ...x, price: v } : x)))}
                        />
                      </div>
                      <button
                        onClick={() => setNewLines(p => p.filter((_, j) => j !== i))}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setNewLines(p => [...p, { desc: '', qty: '1', price: '', tax: '0' }])}
                  className="btn-outline w-full py-2 border-dashed"
                >
                  + Add Line
                </button>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
                <button className="btn-outline" onClick={resetInvForm}>Cancel</button>
                <button className="btn-primary" onClick={createDocument}>
                  {editingInvId ? 'Save Changes' : 'Create Invoice'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AccountingProvider>
  )
}

// ── P&L sub-components ────────────────────────────────────────────────────────
function PLSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
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
        style={{ color: negative ? '#EF4444' : bold ? 'var(--text-1)' : 'var(--text-3)' }}
      >
        {negative ? `(${fmtKes(Math.abs(amount))})` : fmtKes(amount)}
      </span>
    </div>
  )
}
