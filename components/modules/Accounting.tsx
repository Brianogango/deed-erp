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
  faTrash,
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
  | 'vat'
  | 'ageing'
  | 'trial_balance'
  | 'cash_position'
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

const uid = () => crypto.randomUUID()
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
type ManualInvoiceLine = { desc: string; qty: string; price: string; tax: string }
const newManualInvoiceLine = (): ManualInvoiceLine => ({ desc: '', qty: '1', price: '', tax: '0' })

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
    createManualInvoice,
    showToast,
    accounts,
    addAccount,
    updateAccount,
    bankAccounts,
    bankRecons,
    bankStatementLines,
    posOrders,
    expenses,
    payrollRuns,
    purchaseOrders,
    deposits,
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
        { invoices, posOrders, expenses, payrollRuns, purchaseOrders, deposits },
        accounts
      ),
    [invoices, posOrders, expenses, payrollRuns, purchaseOrders, deposits, accounts]
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
    setSelectedInvIds(new Set())
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
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(new Set())
  const [showBulkPayModal, setShowBulkPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('mpesa')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [payReference, setPayReference] = useState('')
  const [payDate, setPayDate] = useState(today())
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingInvId, setEditingInvId] = useState<string | null>(null)
  const [newPartnerId, setNewPartnerId] = useState('')
  const [newPartnerName, setNewPartnerName] = useState('')
  const [newDueDate, setNewDueDate] = useState(addDays(today(), 30))
  const [newLines, setNewLines] = useState<ManualInvoiceLine[]>([newManualInvoiceLine()])
  const [newNotes, setNewNotes] = useState('')
  const [applyVat, setApplyVat] = useState(false)
  const [changingPartner, setChangingPartner] = useState(false)
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
  const canViewJournals = !!currentUser && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
  const canManageFinance = !!currentUser && ['director', 'finance_officer'].includes(currentUser?.role ?? '')
  const customers = contacts.filter(c => c.isCustomer)
  const vendors = contacts.filter(c => c.isVendor)
  const invoiceVatRate = companySettings.vatRate ?? 16

  const invoicePreview = useMemo(() => {
    const lines = newLines.map((line, index) => {
      const qty = Number(line.qty)
      const unitPrice = Number(line.price)
      const normalizedQty = Number.isFinite(qty) && qty > 0 ? qty : 0
      const normalizedPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : -1
      const taxRate = applyVat ? invoiceVatRate : (Number(line.tax) || 0)
      const subtotal = normalizedQty > 0 && normalizedPrice >= 0 ? normalizedQty * normalizedPrice : 0
      const taxAmount = Math.round(subtotal * taxRate / 100)
      return {
        index,
        description: line.desc.trim(),
        qty: normalizedQty,
        unitPrice: Math.max(0, normalizedPrice),
        taxRate,
        subtotal,
        taxAmount,
        total: subtotal + taxAmount,
        valid: !!line.desc.trim() && normalizedQty > 0 && normalizedPrice > 0,
      }
    })
    const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
    const taxTotal = lines.reduce((sum, line) => sum + line.taxAmount, 0)
    const invalidLineIndexes = lines.filter(line => !line.valid).map(line => line.index)
    return {
      lines,
      subtotal,
      taxTotal,
      total: subtotal + taxTotal,
      invalidLineIndexes,
      canSave: !!newPartnerId && invalidLineIndexes.length === 0 && lines.length > 0,
      blockedReason: !newPartnerId
        ? `Select a ${tab === 'bills' ? 'vendor' : 'customer'} before saving.`
        : invalidLineIndexes.length > 0
          ? 'Every line needs a description, quantity greater than zero, and price greater than zero.'
          : lines.length === 0
            ? 'Add at least one line item.'
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
      if (i.type === 'customer_invoice') {
        cust.push(i)
        revDyn += i.subtotal
        if (i.status === 'posted' || i.status === 'partially_paid' || i.status === 'overdue') {
          outAR += i.total - i.amountPaid
        }
      } else if (i.type === 'vendor_bill') {
        vend.push(i)
        if (i.status === 'posted' || i.status === 'partially_paid' || i.status === 'overdue') {
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
      else if (invFilter === 'partially_paid') pass = i.status === 'partially_paid'
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


  const financeReports = useMemo(() => {
    const todayDate = new Date()
    const postedCustomerInvoices = customerInvoices.filter(i => ['posted', 'partially_paid', 'paid', 'overdue'].includes(i.status))
    const postedVendorBills = vendorBills.filter(i => ['posted', 'partially_paid', 'paid', 'overdue'].includes(i.status))
    const outputVat = postedCustomerInvoices.reduce((s, i) => s + (i.taxTotal || 0), 0)
    const inputVat = postedVendorBills.reduce((s, i) => s + (i.taxTotal || 0), 0)
    const vatPayable = outputVat - inputVat

    const bucketRows = (items: Invoice[]) => {
      const rows = items
        .filter(i => ['posted', 'partially_paid', 'overdue'].includes(i.status) && Math.max(0, i.total - i.amountPaid) > 0)
        .map(i => {
          const due = i.dueDate ? new Date(i.dueDate) : new Date(i.date)
          const days = Math.max(0, Math.floor((todayDate.getTime() - due.getTime()) / 86400000))
          const balance = Math.max(0, i.total - i.amountPaid)
          return { id: i.id, ref: i.ref, partnerName: i.partnerName, dueDate: i.dueDate || i.date, balance, current: days <= 0 ? balance : 0, d30: days > 0 && days <= 30 ? balance : 0, d60: days > 30 && days <= 60 ? balance : 0, d90: days > 60 && days <= 90 ? balance : 0, over90: days > 90 ? balance : 0 }
        })
      const totals = rows.reduce((a, r) => ({ balance: a.balance + r.balance, current: a.current + r.current, d30: a.d30 + r.d30, d60: a.d60 + r.d60, d90: a.d90 + r.d90, over90: a.over90 + r.over90 }), { balance: 0, current: 0, d30: 0, d60: 0, d90: 0, over90: 0 })
      return { rows, totals }
    }

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

    return { vat: { outputVat, inputVat, vatPayable, taxableSales: postedCustomerInvoices.reduce((s, i) => s + i.subtotal, 0), taxablePurchases: postedVendorBills.reduce((s, i) => s + i.subtotal, 0) }, arAgeing: bucketRows(customerInvoices), apAgeing: bucketRows(vendorBills), trialBalance, tbTotals, cashPosition, cashTotals }
  }, [customerInvoices, vendorBills, accounts, journalEntries, bankAccounts, allCashbookEntries])

  const financeWorkflowAlerts = useMemo(() => {
    const todayDate = new Date()
    const openBalance = (i: Invoice) => Math.max(0, i.total - i.amountPaid)
    const openStatuses = ['posted', 'partially_paid', 'overdue']
    const overdueInvoices = customerInvoices.filter(i => openStatuses.includes(i.status) && openBalance(i) > 0 && new Date(i.dueDate || i.date) < todayDate)
    const overdueBills = vendorBills.filter(i => openStatuses.includes(i.status) && openBalance(i) > 0 && new Date(i.dueDate || i.date) < todayDate)
    const pendingBills = vendorBills.filter(i => i.status === 'posted' && openBalance(i) > 0)
    const pendingReimbursements = expenses.filter((e: any) => e.reimbursable && e.status === 'approved' && e.reimbursementStatus !== 'reimbursed')
    const pendingPayrollApprovals = payrollRuns.filter((p: any) => p.status === 'pending_approval')
    const unreconciledStatementLines = bankStatementLines.filter((l: any) => l.status !== 'reconciled')
    const activeBankIds = new Set(bankAccounts.filter(a => a.active).map(a => a.id))
    const latestLockedPeriods = bankRecons
      .filter((r: any) => r.status === 'reconciled' && activeBankIds.has(r.bankAccountId))
      .sort((a: any, b: any) => String(b.month).localeCompare(String(a.month)))
      .slice(0, 3)
    const lowCashAccounts = bankAccounts.filter(a => a.active && (cashbookTotals[a.id] ?? a.openingBalance) < 0)

    const alerts = [
      overdueInvoices.length ? { tone: 'danger', label: 'Overdue customer invoices', value: overdueInvoices.length, detail: `${fmtKes(overdueInvoices.reduce((s, i) => s + openBalance(i), 0))} needs collection`, action: () => { setTab('invoices'); setInvFilter('overdue') } } : null,
      overdueBills.length ? { tone: 'warning', label: 'Overdue supplier bills', value: overdueBills.length, detail: `${fmtKes(overdueBills.reduce((s, i) => s + openBalance(i), 0))} payables past due`, action: () => { setTab('bills'); setInvFilter('overdue') } } : null,
      pendingBills.length ? { tone: 'info', label: 'Open supplier bills', value: pendingBills.length, detail: `${fmtKes(pendingBills.reduce((s, i) => s + openBalance(i), 0))} awaiting payment`, action: () => { setTab('bills'); setInvFilter('unpaid') } } : null,
      pendingReimbursements.length ? { tone: 'warning', label: 'Staff reimbursements due', value: pendingReimbursements.length, detail: `${fmtKes(pendingReimbursements.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0))} approved claims`, action: () => setTab('cashbook') } : null,
      pendingPayrollApprovals.length ? { tone: 'warning', label: 'Payroll approvals pending', value: pendingPayrollApprovals.length, detail: 'Review payroll before payment posting', action: () => setTab('cash_position') } : null,
      unreconciledStatementLines.length ? { tone: 'info', label: 'Unreconciled bank lines', value: unreconciledStatementLines.length, detail: 'Match statement lines before month-end close', action: () => setTab('cashbook') } : null,
      lowCashAccounts.length ? { tone: 'danger', label: 'Negative cash accounts', value: lowCashAccounts.length, detail: lowCashAccounts.map(a => a.name).join(', '), action: () => setTab('cash_position') } : null,
    ].filter(Boolean) as { tone: string; label: string; value: number; detail: string; action: () => void }[]

    return { alerts, latestLockedPeriods }
  }, [customerInvoices, vendorBills, expenses, payrollRuns, bankStatementLines, bankRecons, bankAccounts, cashbookTotals])

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
  const resetInvForm = () => {
    setShowNewForm(false)
    setEditingInvId(null)
    setNewPartnerId('')
    setNewPartnerName('')
    setNewDueDate(addDays(today(), 30))
    setNewLines([newManualInvoiceLine()])
    setNewNotes('')
    setApplyVat(false)
    setChangingPartner(false)
    setReceiptFile(null)
  }

  const handleEditInvoice = (inv: Invoice) => {
    setEditingInvId(inv.id)
    setNewPartnerId(inv.partnerId)
    setNewPartnerName(inv.partnerName)
    setNewDueDate(inv.dueDate || addDays(today(), 30))
    setNewLines((inv.lines || []).map(l => ({
      desc: l.description,
      qty: String(l.qty),
      price: String(l.unitPrice),
      tax: String(l.taxRate ?? 0),
    })))
    setNewNotes(inv.notes ?? '')
    setApplyVat((inv.taxTotal ?? 0) > 0)
    setChangingPartner(false)
    setShowNewForm(true)
  }

  // Deep link from /finance/invoices/[id] — open the edit form for the requested invoice.
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (!editId) return
    const inv = allInvoices.find(i => i.id === editId)
    if (inv) {
      handleEditInvoice(inv)
      setTab(inv.type === 'customer_invoice' ? 'invoices' : 'bills')
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete('edit')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams])

  const handleBillFile = async (file: File | null) => {
    if (!file) return
    setReceiptFile(file)
    setIsScanning(true)
    setTimeout(() => {
      setIsScanning(false)
      showToast('Bill uploaded — complete the form fields manually', 'info')
    }, 1500)
  }

  const createDocument = () => {
    if (!invoicePreview.canSave) {
      showToast(invoicePreview.blockedReason || 'Please complete the document before saving', 'error')
      return
    }
    const type = tab === 'invoices' ? 'customer_invoice' : 'vendor_bill'
    const vatRate = applyVat ? invoiceVatRate : 0

    if (editingInvId) {
      const builtLines = invoicePreview.lines.map(l => ({
        id: uid(),
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        subtotal: l.subtotal,
      }))
      updateInvoice(editingInvId, {
        partnerId: newPartnerId,
        partnerName: newPartnerName,
        dueDate: newDueDate,
        lines: builtLines as any,
        subtotal: invoicePreview.subtotal,
        taxTotal: invoicePreview.taxTotal,
        total: invoicePreview.total,
        notes: newNotes,
      })
      showToast('Invoice updated', 'success')
    } else {
      createManualInvoice(type, newPartnerId, newPartnerName, newDueDate, newLines, vatRate, newNotes.trim())
    }
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
    registerPayment, deleteInvoice, updateInvoice, postInvoice, createManualInvoice, addAccount, updateAccount, showToast,
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

  return (
    <AccountingProvider value={ctxValue as any}>
      <div className="mod-page">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="mod-header">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#10B98115', color: '#10B981' }}>
              <Fa icon={faBook} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-extrabold text-text-1">Accounting &amp; Finance</h1>
              <p className="text-[10px] text-text-3 mt-0.5">Invoices, bills &amp; financial reports</p>
            </div>
          </div>
          <button onClick={() => { setTab('invoices'); setShowNewForm(true) }} className="btn-primary flex items-center gap-2 flex-shrink-0">
            <Fa icon={faPlus} />
            <span className="hidden sm:inline">New Invoice</span>
          </button>
        </div>

        {/* ── Stats ──────────────────────────────────────────────────────────── */}
        <div className="px-4 py-3 stat-grid-4 border-b border-border-lt bg-surface">
          <StatCard label="Outstanding AR" value={fmtKes(outstandingAR)} sub="Unpaid invoices" color="#10B981" icon={<Fa icon={faArrowDown} />} />
          <StatCard label="Outstanding AP" value={fmtKes(outstandingAP)} sub="Unpaid vendor bills" color="#EF4444" icon={<Fa icon={faArrowUp} />} />
          <StatCard label="Cash at Bank" value={fmtKes(cashAtBankBS)} sub="Total in bank accounts" color="#3B82F6" icon={<Fa icon={faBook} />} />
          <StatCard label="Cash in Hand" value={fmtKes(cashInHandBS)} sub="Petty cash &amp; M-Pesa" color="#8B5CF6" icon={<Fa icon={faMoneyBillWave} />} />
        </div>

        {/* ── Finance workflow visibility ─────────────────────────────────────── */}
        <div className="px-4 py-3 border-b border-border-lt bg-[var(--surface)]">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-4)]">Finance workflow alerts</p>
              <p className="text-xs text-[var(--text-3)]">Collections, payables, reimbursements, payroll, reconciliation, and cash exceptions.</p>
            </div>
            <Badge status={financeWorkflowAlerts.alerts.length ? 'warning' : 'paid'} label={financeWorkflowAlerts.alerts.length ? `${financeWorkflowAlerts.alerts.length} action${financeWorkflowAlerts.alerts.length === 1 ? '' : 's'}` : 'Clear'} />
          </div>
          {financeWorkflowAlerts.alerts.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {financeWorkflowAlerts.alerts.map(alert => (
                <button key={alert.label} onClick={alert.action} className={`text-left rounded-xl border p-3 transition hover:shadow-sm ${alert.tone === 'danger' ? 'border-red-200 bg-red-50' : alert.tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-[var(--text-1)] truncate">{alert.label}</p>
                      <p className="text-[11px] text-[var(--text-3)] mt-1">{alert.detail}</p>
                    </div>
                    <span className="text-lg font-black tabular-nums text-[var(--text-1)]">{alert.value}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-xs text-green-800 font-semibold">No urgent finance exceptions detected. Keep reconciling bank lines and reviewing month-end reports before close.</div>
          )}
          {financeWorkflowAlerts.latestLockedPeriods.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-[var(--text-3)]">
              <span className="font-bold text-[var(--text-2)]">Recently locked:</span>
              {financeWorkflowAlerts.latestLockedPeriods.map((r: any) => <span key={r.id} className="px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border-lt)]">{bankAccounts.find(a => a.id === r.bankAccountId)?.name || r.bankAccountId} · {r.month}</span>)}
            </div>
          )}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <div className="mod-tabs">
          {(
            [
              { id: 'invoices', label: 'Invoices', icon: faFileInvoiceDollar },
              { id: 'bills', label: 'Bills', icon: faArrowUp },
              { id: 'refunds', label: 'Refunds', icon: faArrowDown },
              { id: 'journals', label: 'Journals', icon: faBook },
              { id: 'coa', label: 'Accounts', icon: faListUl },
              { id: 'gl', label: 'Ledger', icon: faBalanceScale },
              { id: 'partner_ledger', label: 'Partner Ledger', icon: faUsers },
              { id: 'pl', label: 'P&L', icon: faChartLine },
              { id: 'bs', label: 'Balance Sheet', icon: faBalanceScale },
              { id: 'vat', label: 'VAT', icon: faFileInvoiceDollar },
              { id: 'ageing', label: 'Ageing', icon: faUsers },
              { id: 'trial_balance', label: 'Trial Balance', icon: faBalanceScale },
              { id: 'cash_position', label: 'Cash Position', icon: faMoneyBillWave },
              { id: 'cashbook', label: 'Cashbook', icon: faMoneyBillWave },
            ] as const
          ).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`mod-tab ${tab === t.id ? 'active' : ''}`}>
              <Fa icon={t.icon} className="mr-1.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="mod-body">
        {/* ── Tab Content ────────────────────────────────────────────────────── */}
        <div className="card overflow-hidden m-3 sm:m-4">
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
                    <option value="unpaid">Unpaid</option>
                    <option value="partially_paid">Partial</option>
                    <option value="draft">Draft</option>
                    <option value="posted">Posted</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary flex items-center gap-2" onClick={() => {
                    const title = tab === 'invoices' ? 'Customer Invoices' : 'Vendor Bills'
                    exportToExcel(
                      title,
                      ['Number', 'Partner', 'Date', 'Due Date', 'Total', 'Status'],
                      filteredInvoices.map(i => [i.ref, i.partnerName, i.date, i.dueDate ?? '', i.total, i.status]),
                      `${title.replace(/ /g, '_')}_${new Date().toISOString().slice(0, 10)}`,
                    )
                  }}>
                    <Fa icon={faDownload} />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                </div>
              </div>

              {/* Bulk pay action bar — invoices and bills */}
              {(tab === 'invoices' || tab === 'bills') && selectedInvIds.size > 0 && (() => {
                const selItems = filteredInvoices.filter(b => selectedInvIds.has(b.id))
                const totalOutstanding = selItems.reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0)
                const bulkLabel = tab === 'invoices' ? 'Invoice' : 'Bill'
                return (
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-lt)] bg-blue-50 dark:bg-blue-950/30">
                    <span className="text-xs font-bold text-blue-700">{selectedInvIds.size} {bulkLabel.toLowerCase()}{selectedInvIds.size !== 1 ? 's' : ''} selected · {fmtKes(totalOutstanding)} outstanding</span>
                    <div className="flex items-center gap-2">
                      <button className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors" onClick={() => setSelectedInvIds(new Set())}>Clear</button>
                      <button
                        className="btn-primary text-[11px] py-1.5 px-3"
                        style={{ background: '#3B82F6' }}
                        onClick={() => { setPayAmount(String(totalOutstanding)); setShowBulkPayModal(true) }}
                      >
                        Pay {selectedInvIds.size} {bulkLabel}{selectedInvIds.size !== 1 ? 's' : ''} — {fmtKes(totalOutstanding)}
                      </button>
                    </div>
                  </div>
                )
              })()}

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                      {(tab === 'invoices' || tab === 'bills') && (
                        <th className="px-3 py-3 w-10">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={filteredInvoices.filter(b => ['posted','partially_paid','overdue'].includes(b.status) && b.total > b.amountPaid).length > 0 &&
                              filteredInvoices.filter(b => ['posted','partially_paid','overdue'].includes(b.status) && b.total > b.amountPaid).every(b => selectedInvIds.has(b.id))}
                            onChange={e => {
                              const payable = filteredInvoices.filter(b => ['posted','partially_paid','overdue'].includes(b.status) && b.total > b.amountPaid)
                              setSelectedInvIds(e.target.checked ? new Set(payable.map(b => b.id)) : new Set())
                            }}
                          />
                        </th>
                      )}
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Number</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Partner</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Date</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">Due</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-right">Total</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-right">Paid</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-right">Balance</th>
                      <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-lt)]">
                    {filteredInvoices.map(i => {
                      const balance = Math.max(0, i.total - i.amountPaid)
                      const pct = i.total > 0 ? Math.min(100, (i.amountPaid / i.total) * 100) : 0
                      const badgeStatus = i.status === 'paid' ? 'active' : i.status === 'overdue' ? 'cancelled' : i.status === 'partially_paid' ? 'warning' : 'pending'
                      const badgeLabel = i.status === 'partially_paid' ? 'Partial' : i.status
                      const isPayable = (tab === 'invoices' || tab === 'bills') && ['posted','partially_paid','overdue'].includes(i.status) && balance > 0
                      const isSelected = selectedInvIds.has(i.id)
                      return (
                        <tr
                          key={i.id}
                          onClick={() => {
                            if (isPayable) {
                              const next = new Set(selectedInvIds)
                              isSelected ? next.delete(i.id) : next.add(i.id)
                              setSelectedInvIds(next)
                            } else {
                              router.push(`/finance/invoices/${i.id}`)
                            }
                          }}
                          className={`hover:bg-[var(--bg-surface)] cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}
                        >
                          {(tab === 'invoices' || tab === 'bills') && (
                            <td className="px-3 py-3 w-10" onClick={e => e.stopPropagation()}>
                              {isPayable && (
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={isSelected}
                                  onChange={e => {
                                    const next = new Set(selectedInvIds)
                                    e.target.checked ? next.add(i.id) : next.delete(i.id)
                                    setSelectedInvIds(next)
                                  }}
                                />
                              )}
                            </td>
                          )}
                          <td className="px-4 py-3 text-xs font-bold text-primary-600" onClick={() => { if (!isPayable || !isSelected) router.push(`/finance/invoices/${i.id}`) }}>{i.ref}</td>
                          <td className="px-4 py-3 text-xs text-[var(--text-1)]">{i.partnerName}</td>
                          <td className="px-4 py-3 text-xs text-[var(--text-3)]">{fmtDate(i.date)}</td>
                          <td className="px-4 py-3 text-xs text-[var(--text-3)]">{fmtDate(i.dueDate)}</td>
                          <td className="px-4 py-3 text-xs font-bold text-[var(--text-1)] text-right">{fmtKes(i.total)}</td>
                          <td className="px-4 py-3 text-right">
                            {i.amountPaid > 0 ? (
                              <div>
                                <span className="text-xs font-bold text-emerald-600">{fmtKes(i.amountPaid)}</span>
                                {i.status === 'partially_paid' && (
                                  <div className="mt-1 w-16 h-1 bg-[var(--bg-muted)] rounded-full overflow-hidden ml-auto">
                                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-4)]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs font-bold text-right">
                            <span className={balance > 0 ? 'text-red-500' : 'text-emerald-600'}>{balance > 0 ? fmtKes(balance) : '—'}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge status={badgeStatus as any} label={badgeLabel} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === 'refunds' ? (
            <div className="flex flex-col">
              <div className="p-4 border-b border-[var(--border-lt)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-sm font-bold text-[var(--text-1)]">Refund Payments</h2>
                <span className="text-xs text-[var(--text-3)]">{refundPayments.length} record{refundPayments.length !== 1 ? 's' : ''}</span>
              </div>
              {refundPayments.length === 0 ? (
                <div className="p-12 text-center text-[var(--text-3)] text-sm">No refund payments recorded</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ref</th>
                        <th>Date</th>
                        <th>RMA</th>
                        <th>Customer</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refundPayments.map(rp => (
                        <tr key={rp.id}>
                          <td className="font-mono text-xs font-semibold text-[var(--accent)]">{rp.ref}</td>
                          <td className="text-xs">{rp.paymentDate}</td>
                          <td className="text-xs text-[var(--text-2)]">{rp.rmaRef}</td>
                          <td className="text-sm font-medium">{rp.customerName}</td>
                          <td className="text-sm font-semibold text-red-500">{fmtKes(rp.amount)}</td>
                          <td>
                            <span className={`chip text-xs ${rp.paymentMethod === 'cash' ? 'chip-yellow' : rp.paymentMethod === 'mpesa' ? 'chip-green' : 'chip-blue'}`}>
                              {rp.paymentMethod === 'mpesa' ? 'M-Pesa' : rp.paymentMethod === 'bank_transfer' ? 'Bank Transfer' : 'Cash'}
                            </span>
                          </td>
                          <td className="text-xs text-[var(--text-3)] max-w-xs truncate">{rp.notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : tab === 'journals' ? (
            <JournalsTab />
          ) : tab === 'coa' ? (
            <ChartOfAccountsTab />
          ) : tab === 'gl' ? (
            <GeneralLedgerTab />
          ) : tab === 'partner_ledger' ? (
            <PartnerLedgerTab />
          ) : tab === 'pl' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-[var(--text-1)]">Profit & Loss Statement</h2>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary flex items-center gap-2" onClick={() => {
                    const rev = customerInvoices.reduce((s, i) => s + i.subtotal, 0)
                    const cogs = vendorBills.reduce((s, i) => s + i.subtotal, 0)
                    const opex = expenses.reduce((s, e) => s + e.amount, 0)
                    const net = rev - cogs - opex
                    exportToPDF(
                      'Profit & Loss Statement',
                      ['Category', 'Amount (KES)'],
                      [
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
                {(() => {
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
                })()}
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
          ) : tab === 'vat' ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div><h2 className="text-lg font-bold text-[var(--text-1)]">VAT Control Report</h2><p className="text-xs text-[var(--text-3)]">Output VAT less input VAT from posted sales invoices and vendor bills.</p></div>
                <button className="btn-secondary flex items-center gap-2" onClick={() => exportToExcel('VAT Control Report', ['Metric', 'Amount'], [['Taxable Sales', financeReports.vat.taxableSales], ['Output VAT', financeReports.vat.outputVat], ['Taxable Purchases', financeReports.vat.taxablePurchases], ['Input VAT', financeReports.vat.inputVat], ['Net VAT Payable/(Refundable)', financeReports.vat.vatPayable]], `VAT_Report_${new Date().toISOString().slice(0, 10)}`)}><Fa icon={faDownload} /> Export</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <StatCard label="Output VAT" value={fmtKes(financeReports.vat.outputVat)} sub="VAT on customer invoices" color="#2563EB" icon={<Fa icon={faArrowDown} />} />
                <StatCard label="Input VAT" value={fmtKes(financeReports.vat.inputVat)} sub="VAT on vendor bills" color="#059669" icon={<Fa icon={faArrowUp} />} />
                <StatCard label="Net VAT" value={fmtKes(financeReports.vat.vatPayable)} sub={financeReports.vat.vatPayable >= 0 ? 'Payable to KRA' : 'Refundable / credit'} color={financeReports.vat.vatPayable >= 0 ? '#DC2626' : '#10B981'} icon={<Fa icon={faFileInvoiceDollar} />} />
              </div>
              <table className="data-table"><tbody><tr><td>Taxable sales</td><td className="text-right font-mono">{fmtKes(financeReports.vat.taxableSales)}</td></tr><tr><td>Output VAT</td><td className="text-right font-mono">{fmtKes(financeReports.vat.outputVat)}</td></tr><tr><td>Taxable purchases</td><td className="text-right font-mono">{fmtKes(financeReports.vat.taxablePurchases)}</td></tr><tr><td>Input VAT</td><td className="text-right font-mono">{fmtKes(financeReports.vat.inputVat)}</td></tr><tr className="font-bold"><td>Net VAT payable / refundable</td><td className="text-right font-mono">{fmtKes(financeReports.vat.vatPayable)}</td></tr></tbody></table>
            </div>
          ) : tab === 'ageing' ? (
            <div className="p-6 space-y-6"><AgeingReport title="Receivables Ageing" rows={financeReports.arAgeing.rows} totals={financeReports.arAgeing.totals} /><AgeingReport title="Payables Ageing" rows={financeReports.apAgeing.rows} totals={financeReports.apAgeing.totals} /></div>
          ) : tab === 'trial_balance' ? (
            <div className="p-6"><div className="flex items-center justify-between mb-5"><div><h2 className="text-lg font-bold text-[var(--text-1)]">Trial Balance</h2><p className="text-xs text-[var(--text-3)]">Account balances from posted journals and opening balances.</p></div><span className={`badge ${Math.abs(financeReports.tbTotals.debit - financeReports.tbTotals.credit) < 0.01 ? 'badge-green' : 'badge-red'}`}>{Math.abs(financeReports.tbTotals.debit - financeReports.tbTotals.credit) < 0.01 ? 'Balanced' : 'Out of Balance'}</span></div><table className="data-table"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody>{financeReports.trialBalance.map(row => <tr key={row.id}><td className="font-mono text-xs">{row.code}</td><td>{row.name}</td><td className="capitalize text-xs">{row.type}</td><td className="text-right font-mono">{row.debit ? fmtKes(row.debit) : '—'}</td><td className="text-right font-mono">{row.credit ? fmtKes(row.credit) : '—'}</td></tr>)}<tr className="font-bold"><td colSpan={3}>Totals</td><td className="text-right font-mono">{fmtKes(financeReports.tbTotals.debit)}</td><td className="text-right font-mono">{fmtKes(financeReports.tbTotals.credit)}</td></tr></tbody></table></div>
          ) : tab === 'cash_position' ? (
            <div className="p-6"><h2 className="text-lg font-bold text-[var(--text-1)] mb-5">Cash Position</h2><table className="data-table"><thead><tr><th>Account</th><th>Bank</th><th className="text-right">Opening</th><th className="text-right">Inflows</th><th className="text-right">Outflows</th><th className="text-right">Balance</th></tr></thead><tbody>{financeReports.cashPosition.map(row => <tr key={row.id}><td className="font-semibold">{row.name}</td><td className="text-xs text-[var(--text-3)]">{row.bankName || (row.active ? 'Active cash account' : 'Inactive')}</td><td className="text-right font-mono">{fmtKes(row.opening)}</td><td className="text-right font-mono text-emerald-600">{fmtKes(row.inflows)}</td><td className="text-right font-mono text-red-500">{fmtKes(row.outflows)}</td><td className="text-right font-mono font-bold">{fmtKes(row.balance)}</td></tr>)}<tr className="font-bold"><td colSpan={2}>Total Cash</td><td className="text-right font-mono">{fmtKes(financeReports.cashTotals.opening)}</td><td className="text-right font-mono text-emerald-600">{fmtKes(financeReports.cashTotals.inflows)}</td><td className="text-right font-mono text-red-500">{fmtKes(financeReports.cashTotals.outflows)}</td><td className="text-right font-mono">{fmtKes(financeReports.cashTotals.balance)}</td></tr></tbody></table></div>
          ) : (
            <CashbookTab accounts={accounts} />
          )}
        </div>

        {/* ── BULK PAYMENT MODAL ── */}
        {showBulkPayModal && (() => {
          const selItems = filteredInvoices.filter(b => selectedInvIds.has(b.id))
          const totalOutstanding = selItems.reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0)
          const activeBanks = bankAccounts.filter(a => a.active)
          const bulkLabel = tab === 'invoices' ? 'Invoice' : 'Bill'
          const bulkPartnerLabel = tab === 'invoices' ? 'Customer' : 'Vendor'
          return (
            <Modal title={`Pay ${selItems.length} ${bulkLabel}${selItems.length !== 1 ? 's' : ''}`} subtitle={`Total outstanding: ${fmtKes(totalOutstanding)}`} onClose={() => setShowBulkPayModal(false)} width={500}>
              <div className="flex flex-col gap-4">
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
                  <Field label="Bank / Account Paid From">
                    <Select value={payBankAccountId} onChange={setPayBankAccountId} options={[
                      { value: '', label: '— Select bank account —' },
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
                    style={{ background: '#3B82F6' }}
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
                    Confirm Payment — {fmtKes(totalOutstanding)}
                  </button>
                </div>
              </div>
            </Modal>
          )
        })()}

        {showNewForm && (
          <Modal
            title={editingInvId ? 'Edit Invoice' : (tab === 'bills' ? 'New Vendor Bill' : 'New Invoice')}
            onClose={resetInvForm}
            width={980}
          >
            <div className="flex flex-col min-h-[560px]">
              <div className="p-4 -mx-6 -mt-6 mb-6 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
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
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
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
                    renderItem={c => (
                      <div>
                        <p className="font-bold text-xs">{(c as any).name}</p>
                        <p className="text-[10px] text-[var(--text-4)]">{(c as any).email ?? ''}</p>
                      </div>
                    )}
                  />
                  </div>
                )}
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
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
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

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-1)]">Line Items</h4>
                    <p className="text-[10px] text-[var(--text-4)] mt-0.5">Use positive quantity and price for every line.</p>
                  </div>
                  <span className="text-[10px] font-bold text-[var(--text-4)]">{newLines.length} line{newLines.length === 1 ? '' : 's'}</span>
                </div>
                <div className="border border-[var(--border-lt)] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[720px]">
                      <thead>
                        <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)]">Description</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-center w-24">Qty</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-36">Unit Price</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-24">Tax</th>
                          <th className="px-3 py-2.5 text-[10px] font-bold uppercase text-[var(--text-4)] text-right w-36">Line Total</th>
                          <th className="px-3 py-2.5 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-lt)]">
                        {newLines.map((l, i) => {
                          const previewLine = invoicePreview.lines[i]
                          const isInvalid = invoicePreview.invalidLineIndexes.includes(i)
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
                                  className="form-input text-xs text-center w-20"
                                  value={l.qty}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                                />
                                {isInvalid && Number(l.qty) <= 0 && <p className="text-[9px] text-red-600 font-semibold mt-1 text-center">Qty &gt; 0</p>}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  className="form-input text-xs text-right w-32"
                                  value={l.price}
                                  onChange={e => setNewLines(p => p.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                                />
                                {isInvalid && Number(l.price) <= 0 && <p className="text-[9px] text-red-600 font-semibold mt-1 text-right">Price &gt; 0</p>}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  className="form-select text-xs w-20"
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
                                {previewLine?.taxAmount ? <p className="text-[9px] text-[var(--text-4)] mt-0.5">Incl. tax {fmtKes(previewLine.taxAmount)}</p> : null}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => setNewLines(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}
                                  disabled={newLines.length === 1}
                                  className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-4)] hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
                                  aria-label={`Remove line ${i + 1}`}
                                >
                                  <Fa icon={faTrash} className="text-[9px]" />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-2.5 border-t border-[var(--border-lt)] bg-[var(--bg-surface)]">
                    <button
                      type="button"
                      onClick={() => setNewLines(p => [...p, newManualInvoiceLine()])}
                      className="flex items-center gap-2 text-xs text-primary-600 hover:underline font-semibold cursor-pointer"
                    >
                      <Fa icon={faPlus} className="text-[10px]" /> Add a line
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="flex flex-col gap-4">
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
                </div>

                <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-xs font-bold text-[var(--text-2)]">Summary</h4>
                    <Badge status={invoicePreview.canSave ? 'paid' : 'warning'} label={invoicePreview.canSave ? 'Ready' : 'Incomplete'} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between text-xs"><span className="text-[var(--text-3)]">Subtotal</span><span className="font-bold">{fmtKes(invoicePreview.subtotal)}</span></div>
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

              <div className="flex items-center justify-between pt-4 border-t border-[var(--border-lt)]">
                <button className="btn-outline text-xs cursor-pointer" onClick={resetInvForm}>Discard</button>
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

        </div>{/* mod-body */}
      </div>
    </AccountingProvider>
  )
}

// ── P&L sub-components ────────────────────────────────────────────────────────
function AgeingReport({ title, rows, totals }: { title: string; rows: { id: string; ref: string; partnerName: string; dueDate: string; balance: number; current: number; d30: number; d60: number; d90: number; over90: number }[]; totals: { balance: number; current: number; d30: number; d60: number; d90: number; over90: number } }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-[var(--text-1)]">{title}</h2>
        <span className="text-xs font-bold text-[var(--text-3)]">Total: {fmtKes(totals.balance)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Partner</th>
              <th>Due Date</th>
              <th className="text-right">Current</th>
              <th className="text-right">1-30</th>
              <th className="text-right">31-60</th>
              <th className="text-right">61-90</th>
              <th className="text-right">90+</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <tr key={r.id}><td className="font-mono text-xs">{r.ref}</td><td>{r.partnerName}</td><td className="text-xs">{fmtDate(r.dueDate)}</td><td className="text-right font-mono">{r.current ? fmtKes(r.current) : '—'}</td><td className="text-right font-mono">{r.d30 ? fmtKes(r.d30) : '—'}</td><td className="text-right font-mono">{r.d60 ? fmtKes(r.d60) : '—'}</td><td className="text-right font-mono">{r.d90 ? fmtKes(r.d90) : '—'}</td><td className="text-right font-mono">{r.over90 ? fmtKes(r.over90) : '—'}</td><td className="text-right font-mono font-bold">{fmtKes(r.balance)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={9} className="text-center text-[var(--text-3)] py-6">No outstanding balances</td></tr>}
            <tr className="font-bold"><td colSpan={3}>Totals</td><td className="text-right font-mono">{fmtKes(totals.current)}</td><td className="text-right font-mono">{fmtKes(totals.d30)}</td><td className="text-right font-mono">{fmtKes(totals.d60)}</td><td className="text-right font-mono">{fmtKes(totals.d90)}</td><td className="text-right font-mono">{fmtKes(totals.over90)}</td><td className="text-right font-mono">{fmtKes(totals.balance)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

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
