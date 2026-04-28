'use client'
import { useMemo, useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  useApp, Invoice, InvoiceLine, JournalEntry, RefundPayment, Account,
  fmtKes, fmtDate,
} from '@/lib/store'
import { downloadPdf, printPdf, PdfLine } from '@/lib/pdf'
import { CO } from '@/lib/company'
import { exportToPDF, exportToExcel, type ExportRow } from '@/lib/export-utils'
import { generateInvoicesHtml } from './invoice-pdf'
import {
  Badge, Modal, Field, Input, Select, Confirm, StatCard,
  PanelHeader, Divider, SearchPicker, ExportButtons, ModuleSkeleton,
  TabContent,
} from '@/components/ui'
import { Fa } from '@/components/icons'
import {
  faArrowDown, faTriangleExclamation, faMoneyBillWave, faArrowUp,
  faBook, faBalanceScale, faChartLine, faListUl, faUsers,
  faPrint, faDownload, faPlus, faPencil,
} from '@fortawesome/free-solid-svg-icons'
import CashbookTab, { buildCashbookEntries } from './Cashbook'

type MainTab = 'invoices' | 'bills' | 'journals' | 'refunds' | 'coa' | 'gl' | 'partner_ledger' | 'pl' | 'bs' | 'cashbook'

// ── Balance Sheet group lists ─────────────────────────────────────────────────
const CA_GROUPS    = ['Inventory - Closing', 'Receivables - Product', 'Receivables - Services', 'Receivables - Repair', 'Receivables - Other', 'Prepayments - Product', 'Prepayments - Services', 'Prepayments - Repair', 'Prepayments - Other', 'Cash at Bank', 'Cash in Hand']
const NCA_GROUPS   = ['PPE - Cost', 'Accumulated Depreciation']
const CL_GROUPS    = ['Payables - Product', 'Payables - Services', 'Payables - Repair', 'Payables - Other', 'Accruals', 'Statutory Liabilities']
const NCL_GROUPS   = ['Non-Current Liabilities']
// ── P&L group lists ───────────────────────────────────────────────────────────
const REV_GROUPS    = ['Revenue - Products', 'Revenue - Solutions', 'Revenue - Repair']
const OI_GROUPS     = ['Other Income']
const OS_GROUPS     = ['Inventory - Opening']   // Opening Stock (COGS)
const PUR_GROUPS    = ['Local Purchases', 'Import Purchases']
const DIRECT_GROUPS = ['Direct Expenses', 'Other Direct Expenses']
const CS_GROUPS     = ['Inventory - Closing']   // Closing Stock (negative in COGS)
const OPEX_GROUPS   = ['Operating Expenses']
const EMP_GROUPS    = ['Employment Expenses']
const FIN_GROUPS    = ['Financial Expenses']

const uid = () => Math.random().toString(36).slice(2, 9)
const today = () => new Date().toISOString().slice(0, 10)
const addDays = (d: string, n: number) => {
  const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10)
}
const FISCAL_YEAR = new Date().getFullYear().toString()
const REPORT_DATE = new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
const row = (label: string, value: string, y: number, bold = false, indent = 0): PdfLine[] => [
  { text: label, x: 40 + indent, y, size: 10, bold },
  { text: value, x: 430,        y, size: 10, bold },
]
const sectionHeader = (label: string, y: number): PdfLine[] => [
  { text: label, x: 40, y, size: 11, bold: true },
]

// ─────────────────────────────────────────────────────────────────────────────
export default function Accounting() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
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
    invoices, contacts, journalEntries, refundPayments, users, currentUserId,
    registerPayment, deleteInvoice, updateInvoice, postInvoice, showToast,
    accounts, addAccount, updateAccount,
    bankAccounts, posOrders, expenses, payrollRuns, purchaseOrders,
    companySettings,
  } = appState

  // Dynamic PDF header builder using live companySettings
  const primaryBank = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')
  const hdr = (lines: PdfLine[], title: string, subtitle: string): PdfLine[] => {
    const bankLine = primaryBank
      ? `Bank: ${primaryBank.bankName} | Acct: ${primaryBank.accountNo}`
      : `Bank: ${CO.bankName} | Acct: ${CO.bankAccount} | Branch: ${CO.bankBranch} | SWIFT: ${CO.swiftCode}`
    const mpesaLine = `M-Pesa Paybill: ${companySettings.mpesaPaybill || CO.mpesaPaybill}, Acct: ${companySettings.mpesaAccount || CO.mpesaAccount}`
    return [
      { text: companySettings.name,                                          x: 40, y: 810, size: 13, bold: true },
      { text: `${companySettings.address}, ${companySettings.city}`,         x: 40, y: 796, size: 8 },
      { text: `Tel: ${companySettings.phone}  |  ${companySettings.website}`,x: 40, y: 785, size: 8 },
      { text: `KRA PIN: ${companySettings.kraPin}`,                          x: 40, y: 774, size: 8 },
      { text: `Prepared: ${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}`, x: 430, y: 810, size: 8 },
      { text: title,    x: 40, y: 756, size: 13, bold: true },
      { text: subtitle, x: 40, y: 742, size: 8 },
      { text: '—'.repeat(80), x: 40, y: 733, size: 9 },
      ...lines,
      { text: '—'.repeat(80), x: 40, y: 110, size: 9 },
      { text: 'Prepared by: _________________________',  x: 40,  y: 88, size: 8 },
      { text: 'Approved by: _________________________',  x: 295, y: 88, size: 8 },
      { text: `${companySettings.name}  ·  ${companySettings.address}  ·  ${companySettings.phone}  ·  KRA: ${companySettings.kraPin}`, x: 40, y: 62, size: 7 },
      { text: bankLine,   x: 40, y: 52, size: 7 },
      { text: `${mpesaLine}  ·  Accrual basis — IFRS compliant`, x: 40, y: 42, size: 7 },
    ]
  }

  // ── Cashbook-derived cash balances (for Balance Sheet) ────────────────────
  const allCashbookEntries = useMemo(
    () => buildCashbookEntries({ invoices, posOrders, expenses, payrollRuns, purchaseOrders }, accounts),
    [invoices, posOrders, expenses, payrollRuns, purchaseOrders, accounts],
  )
  const cashbookTotals = useMemo(() => {
    const map: Record<string, number> = {}
    for (const acc of bankAccounts) map[acc.id] = acc.openingBalance
    for (const e of allCashbookEntries) {
      if (map[e.bankAccountId] !== undefined) {
        map[e.bankAccountId] += (e.credit - e.debit)
      }
    }
    return map
  }, [allCashbookEntries, bankAccounts])
  // Cash at Bank = NCBA + Equity + KCB (bank accounts)
  const cashAtBankBS = (cashbookTotals['ncba'] ?? 0) + (cashbookTotals['equity'] ?? 0) + (cashbookTotals['kcb'] ?? 0)
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
    code: '', name: '', type: 'asset', group: '', subGroup: '', isActive: true, balance: 0, notes: '',
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
  const customers = contacts.filter(c => c.isCustomer)
  const vendors   = contacts.filter(c => c.isVendor)

  const { allInvoices, customerInvoices, vendorBills, outstandingAR, outstandingAP, totalRevenueDynamic } = useMemo(() => {
    const all = [...invoices, ...localInvoices]
    const cust: Invoice[] = []
    const vend: Invoice[] = []
    let outAR = 0, outAP = 0, revDyn = 0

    for (const i of all) {
      if (i.type === 'customer_invoice') {
        cust.push(i)
        revDyn += i.subtotal
        if (i.status === 'posted' || i.status === 'overdue') {
          outAR += (i.total - i.amountPaid)
        }
      } else if (i.type === 'vendor_bill') {
        vend.push(i)
        if (i.status === 'posted' || i.status === 'overdue') {
          outAP += (i.total - i.amountPaid)
        }
      }
    }
    return { allInvoices: all, customerInvoices: cust, vendorBills: vend, outstandingAR: outAR, outstandingAP: outAP, totalRevenueDynamic: revDyn }
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
        if (!q || i.ref.toLowerCase().includes(q) || i.partnerName.toLowerCase().includes(q)) {
          res.push(i)
        }
      }
    }
    return res
  }, [tab, customerInvoices, vendorBills, invFilter, invSearch])

  const filteredJournals = useMemo(() => {
    const q = journalRef.toLowerCase()
    const res: JournalEntry[] = []
    for (const e of journalEntries) {
      if (invFilter !== 'all' && e.status !== invFilter) continue
      if (journalDate && e.date !== journalDate) continue
      if (journalSource !== 'all' && e.source !== journalSource) continue
      if (q && !e.ref.toLowerCase().includes(q)) continue
      res.push(e)
    }
    return res
  }, [journalEntries, invFilter, journalDate, journalSource, journalRef])

  const payrollExpense = useMemo(() => {
    let s = 0
    for (const e of journalEntries) {
      if (e.source === 'payroll') {
        for (const l of e.lines) {
          const acct = l.account.toLowerCase()
          if (acct.includes('salary') || acct.includes('wage')) s += (l.debit ?? 0)
        }
      }
    }
    return s
  }, [journalEntries])

  // Helper: resolve live balance for any account
  const liveBalance = useCallback((a: Account) => {
    if (!a.isDynamic) return a.balance
    if (a.dynamicKey === 'ar')        return outstandingAR
    if (a.dynamicKey === 'ap')        return outstandingAP
    if (a.dynamicKey === 'revenue')   return totalRevenueDynamic
    if (a.dynamicKey === 'salaries')  return payrollExpense || 48_000
    return 0 // net_profit handled separately
  }, [outstandingAR, outstandingAP, totalRevenueDynamic, payrollExpense])

  const { staticRevenue, otherIncome, openingStock, totalPurchases, directExpenses, closingStock, staticOpex, empExpenses, finExpenses } = useMemo(() => {
    let stRev = 0, othInc = 0, opStk = 0, totPurch = 0, dirExp = 0, clStk = 0, stOpx = 0, empExp = 0, finExp = 0
    for (const a of accounts) {
      const grp = a.group
      if (REV_GROUPS.includes(grp) && !a.isDynamic) stRev += a.balance
      else if (OI_GROUPS.includes(grp)) othInc += a.balance
      else if (OS_GROUPS.includes(grp)) opStk += a.balance
      else if (PUR_GROUPS.includes(grp)) totPurch += a.balance
      else if (DIRECT_GROUPS.includes(grp)) dirExp += liveBalance(a)
      else if (CS_GROUPS.includes(grp)) clStk += a.balance
      else if (OPEX_GROUPS.includes(grp)) stOpx += a.balance
      else if (EMP_GROUPS.includes(grp) && !a.isDynamic) empExp += a.balance
      else if (FIN_GROUPS.includes(grp)) finExp += a.balance
    }
    return { staticRevenue: stRev, otherIncome: othInc, openingStock: opStk, totalPurchases: totPurch, directExpenses: dirExp, closingStock: clStk, staticOpex: stOpx, empExpenses: empExp, finExpenses: finExp }
  }, [accounts, liveBalance])

  const totalRevenue        = totalRevenueDynamic + staticRevenue + otherIncome

  const totalCOGS       = openingStock + totalPurchases + directExpenses - closingStock

  const totalSalaries   = payrollExpense || 48_000
  const totalOpex       = staticOpex + totalSalaries + empExpenses + finExpenses
  const grossProfit     = totalRevenue - totalCOGS
  const operatingProfit = grossProfit - totalOpex
  const incomeTax       = Math.max(0, Math.round(operatingProfit * 0.30))
  const netProfit       = operatingProfit - incomeTax

  const plExcelRows: ExportRow[] = [
    ['REVENUE', ''],
    ['  Sales — Products (invoices)', totalRevenueDynamic],
    ['  Static Revenue', staticRevenue],
    ['  Other Income', otherIncome],
    ['Total Revenue', totalRevenue],
    ['', ''],
    ['COST OF GOODS SOLD', ''],
    ['  Opening Stock', openingStock],
    ['  Purchases', totalPurchases],
    ['  Direct Expenses', directExpenses],
    ['  Closing Stock', -closingStock],
    ['Total COGS', totalCOGS],
    ['', ''],
    ['GROSS PROFIT', grossProfit],
    ['', ''],
    ['OPERATING EXPENSES', ''],
    ['  Salaries & Wages', totalSalaries],
    ['  OPEX', staticOpex],
    ['  Employee Expenses', empExpenses],
    ['  Finance Expenses', finExpenses],
    ['Total OPEX', totalOpex],
    ['', ''],
    ['OPERATING PROFIT', operatingProfit],
    ['  Income Tax (30%)', incomeTax],
    ['NET PROFIT AFTER TAX', netProfit],
  ]

  // KPIs
  const receivables = outstandingAR
  const collected   = customerInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0)
  const payables    = outstandingAP
  const overdueAmt  = customerInvoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.total, 0)
  const getBalance  = (inv: Invoice) => Math.max(0, inv.total - inv.amountPaid)

  const invoicesToTotal = selectedInvIds.size > 0 ? filteredInvoices.filter(i => selectedInvIds.has(i.id)) : filteredInvoices
  const displayInvTotal = invoicesToTotal.reduce((s, i) => s + i.total, 0)
  const displayInvBalance = invoicesToTotal.reduce((s, i) => s + getBalance(i), 0)

  const printInvoices = (invs: Invoice[]) => {
    const html = generateInvoicesHtml(invs, appState.saleOrders, appState.deliveries, appState.serials, companySettings, bankAccounts)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const frame = document.createElement('iframe')
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    frame.src = url
    document.body.appendChild(frame)
    frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print() }
    setTimeout(() => { frame.parentNode?.removeChild(frame); URL.revokeObjectURL(url) }, 60000)
  }

  // ── Chart of Accounts filtered ───────────────────────────────────────────────
  const filteredAccounts = accounts.filter(a => {
    const q = coaSearch.toLowerCase()
    return (coaTypeFilter === 'all' || a.type === coaTypeFilter)
      && (!q || a.name.toLowerCase().includes(q) || a.code.includes(q)
          || a.group.toLowerCase().includes(q) || (a.subGroup ?? '').toLowerCase().includes(q))
  }).sort((a, b) => a.code.localeCompare(b.code))

  const glWithBalance = useMemo(() => {
    if (!glAccount) return []
    const match = glAccount.toLowerCase()
    let running = 0
    const res = []
    for (const e of journalEntries) {
      for (const l of e.lines) {
        if (l.account.toLowerCase().includes(match)) {
          running += (l.debit || 0) - (l.credit || 0)
          res.push({ ...l, entryRef: e.ref, entryDate: e.date, entryDesc: e.description, source: e.source, runningBalance: running })
        }
      }
    }
    return res
  }, [glAccount, journalEntries])

  // ── Partner Ledger ────────────────────────────────────────────────────────────
  const partnerTransactions = useMemo(() => {
    if (!plPartner) return []
    const match = plPartner.toLowerCase()
    const txns = allInvoices
      .filter(i => i.partnerName.toLowerCase().includes(match) || i.partnerId === plPartner)
      .sort((a, b) => a.date.localeCompare(b.date))
    let running = 0
    const res = []
    for (const i of txns) {
      const amt = i.type === 'customer_invoice' ? i.total : -i.total
      running += amt
      res.push({ ...i, movingBalance: running, outstanding: i.total - i.amountPaid })
    }
    return res
  }, [plPartner, allInvoices])

  // ── Date Filters applied to ledgers ──────────────────────────────────────────
  const filteredGlWithBalance = useMemo(() => {
    return glWithBalance.filter(l => (!glDateFrom || l.entryDate >= glDateFrom) && (!glDateTo || l.entryDate <= glDateTo))
  }, [glWithBalance, glDateFrom, glDateTo])

  const filteredPartnerTransactions = useMemo(() => {
    return partnerTransactions.filter(t => (!plDateFrom || t.date >= plDateFrom) && (!plDateTo || t.date <= plDateTo))
  }, [partnerTransactions, plDateFrom, plDateTo])


  // ── Invoice handlers ─────────────────────────────────────────────────────────
  const handlePayment = () => {
    if (!viewInv) return
    const amount = Number(payAmount) || 0
    if (amount <= 0) { showToast('Enter a valid amount', 'error'); return }
    if (localInvoices.find(i => i.id === viewInv.id)) {
      setLocalInvoices(p => p.map(i => {
        if (i.id !== viewInv.id) return i
        const paid = i.amountPaid + amount
        return { ...i, amountPaid: paid, status: paid >= i.total ? 'paid' : 'posted' }
      }))
      showToast('Payment registered')
    } else {
      registerPayment(viewInv.id, amount, payMethod, payBankAccountId, payReference)
    }
    setViewInv(prev => prev
      ? { ...prev, amountPaid: prev.amountPaid + amount, status: (prev.amountPaid + amount) >= prev.total ? 'paid' : 'posted' }
      : null)
    setShowPayModal(false); setPayAmount(''); setPayReference(''); setPayBankAccountId('')
  }

  function handleBillFile(file: File | null) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { showToast('File too large', 'error'); return }
    setReceiptFile(file)
    setIsScanning(true)
    setTimeout(() => {
      const mockExtractions = [
        { vendor: 'Safaricom', lines: [{ desc: 'Internet Services', qty: '1', price: '5000', tax: '16' }] },
        { vendor: 'Text Book Centre', lines: [{ desc: 'Office Stationery', qty: '5', price: '450', tax: '16' }, { desc: 'Printer Ink', qty: '2', price: '3200', tax: '16' }] },
        { vendor: 'Kenya Power', lines: [{ desc: 'Electricity Bill', qty: '1', price: '12500', tax: '16' }] },
      ]
      const pick = mockExtractions[Math.floor(Math.random() * mockExtractions.length)]
      const matchedVendor = vendors.find(v => v.name.toLowerCase().includes(pick.vendor.toLowerCase()))
      if (matchedVendor) {
        setNewPartnerId(matchedVendor.id)
        setNewPartnerName(matchedVendor.name)
      } else {
        setNewPartnerName(pick.vendor)
        setNewPartnerId('') 
      }
      setNewLines(pick.lines)
      setIsScanning(false)
      showToast('Bill details extracted via AI', 'success')
    }, 1500)
  }

  const resetInvForm = () => {
    setShowNewForm(false); setEditingInvId(null)
    setNewPartnerId(''); setNewPartnerName('')
    setNewDueDate(addDays(today(), 30))
    setNewLines([{ desc: '', qty: '1', price: '', tax: '0' }])
    setApplyVat(false)
    setReceiptFile(null)
    setIsScanning(false)
    setDragOver(false)
  }

  const openEditInvoice = (inv: Invoice) => {
    setEditingInvId(inv.id)
    setNewPartnerId(inv.partnerId)
    setNewPartnerName(inv.partnerName)
    setNewDueDate(inv.dueDate)
    setNewLines(inv.lines.map(l => ({
      desc: l.description, qty: String(l.qty), price: String(l.unitPrice), tax: String(l.taxRate),
    })))
    setApplyVat(inv.taxTotal > 0)
    setShowNewForm(true)
  }

  const createDocument = () => {
    if (!newPartnerId) { showToast('Select a partner', 'error'); return }
    const lines: InvoiceLine[] = newLines.filter(l => l.desc && l.price).map(l => {
      const qty = Number(l.qty) || 1
      const price = Number(l.price) || 0
      const sub = qty * price
      return { id: uid(), description: l.desc, qty, unitPrice: price, taxRate: Number(l.tax) || 0, subtotal: sub }
    })
    if (!lines.length) { showToast('Add at least one line', 'error'); return }
    const sub = lines.reduce((a, l) => a + l.subtotal, 0)
    const tax = lines.reduce((a, l) => a + Math.round(l.subtotal * l.taxRate / 100), 0)

    if (editingInvId) {
      const updates = { lines, subtotal: sub, taxTotal: tax, total: sub + tax, dueDate: newDueDate, partnerId: newPartnerId, partnerName: newPartnerName }
      if (localInvoices.find(i => i.id === editingInvId)) {
        setLocalInvoices(p => p.map(i => i.id === editingInvId ? { ...i, ...updates } : i))
      } else {
        updateInvoice(editingInvId, updates)
      }
      setViewInv(p => p?.id === editingInvId ? { ...p, ...updates } : p)
      showToast('Invoice updated')
      resetInvForm(); return
    }

    const refNum = String(Math.floor(Math.random() * 9000) + 1000)
    const inv: Invoice = {
      id: uid(),
      ref: tab === 'invoices' ? `INV/${refNum}` : `BILL/${refNum}`,
      type: tab === 'invoices' ? 'customer_invoice' : 'vendor_bill',
      status: 'posted', partnerId: newPartnerId, partnerName: newPartnerName,
      date: today(), dueDate: newDueDate,
      lines, subtotal: sub, taxTotal: tax, total: sub + tax, amountPaid: 0, notes: '',
    }
    setLocalInvoices(p => [inv, ...p])
    showToast(`${inv.ref} created`)
    setViewInv(inv)
    resetInvForm()
  }

  // ── Account form handlers ────────────────────────────────────────────────────
  const openNewAccount = () => {
    setAccountForm({ code: '', name: '', type: 'asset', group: '', subGroup: '', isActive: true, balance: 0, notes: '' })
    setEditAccountId(null)
    setShowAccountForm(true)
  }
  const openEditAccount = (a: Account) => {
    setAccountForm({ code: a.code, name: a.name, type: a.type, group: a.group, subGroup: a.subGroup ?? '', isActive: a.isActive, balance: a.balance, notes: a.notes })
    setEditAccountId(a.id)
    setShowAccountForm(true)
  }
  const saveAccount = () => {
    if (!accountForm.code.trim() || !accountForm.name.trim()) return
    editAccountId ? updateAccount(editAccountId, accountForm) : addAccount(accountForm)
    setShowAccountForm(false)
  }
  const af = (k: string) => (v: any) => setAccountForm(p => ({ ...p, [k]: v }))

  // ── PDF builders ──────────────────────────────────────────────────────────────
  // ── Balance Sheet helpers ─────────────────────────────────────────────────────
  const bsLive = (a: Account) => a.isDynamic
    ? (a.dynamicKey === 'ar' ? outstandingAR : a.dynamicKey === 'ap' ? outstandingAP : a.balance)
    : a.balance
  // sumGroup uses cashbook-derived totals for cash groups instead of static COA balances
  const sumGroup = (groups: string[]) =>
    groups.reduce((total, group) => {
      if (group === 'Cash at Bank') return total + cashAtBankBS
      if (group === 'Cash in Hand') return total + cashInHandBS
      return total + accounts.filter(a => a.group === group).reduce((s, a) => s + bsLive(a), 0)
    }, 0)

  const bsExcelRows: ExportRow[] = (() => {
    const totalCa  = sumGroup(CA_GROUPS)
    const totalNca = sumGroup(NCA_GROUPS)
    const totalCl  = sumGroup(CL_GROUPS)
    const totalNcl = sumGroup(NCL_GROUPS)
    const staticEq = accounts.filter(a => a.group === 'Equity' && !a.isDynamic).reduce((s, a) => s + a.balance, 0)
    const totalEq  = staticEq + netProfit
    const rows: ExportRow[] = [
      ['ASSETS', ''],
      ['Current Assets', ''],
      ...CA_GROUPS.map(g => {
        const total = g === 'Cash at Bank' ? cashAtBankBS : g === 'Cash in Hand' ? cashInHandBS
          : accounts.filter(a => a.group === g).reduce((s, a) => s + bsLive(a), 0)
        return total !== 0 ? [`  ${g}`, total] : null
      }).filter(Boolean) as ExportRow[],
      ['Total Current Assets', totalCa],
      ['Non-Current Assets', ''],
      ...accounts.filter(a => NCA_GROUPS.includes(a.group) && a.balance !== 0).map(a => [`  ${a.name}`, a.balance] as ExportRow),
      ['Total Non-Current Assets (Net)', totalNca],
      ['TOTAL ASSETS', totalCa + totalNca],
      ['', ''],
      ['LIABILITIES', ''],
      ['Current Liabilities', ''],
      ...CL_GROUPS.map(g => {
        const total = accounts.filter(a => a.group === g).reduce((s, a) => s + bsLive(a), 0)
        return total !== 0 ? [`  ${g}`, total] : null
      }).filter(Boolean) as ExportRow[],
      ['Total Current Liabilities', totalCl],
      ['Non-Current Liabilities', ''],
      ...NCL_GROUPS.map(g => {
        const total = accounts.filter(a => a.group === g).reduce((s, a) => s + bsLive(a), 0)
        return total !== 0 ? [`  ${g}`, total] : null
      }).filter(Boolean) as ExportRow[],
      ['Total Non-Current Liabilities', totalNcl],
      ['TOTAL LIABILITIES', totalCl + totalNcl],
      ['', ''],
      ['EQUITY', ''],
      ...accounts.filter(a => a.group === 'Equity' && !a.isDynamic).map(a => [`  ${a.name}`, a.balance] as ExportRow),
      ['  Retained Earnings (Net Profit)', netProfit],
      ['TOTAL EQUITY', totalEq],
      ['', ''],
      ['TOTAL LIABILITIES + EQUITY', totalCl + totalNcl + totalEq],
    ]
    return rows
  })()

  const buildBSPdf = (): PdfLine[] => {
    const totalCa   = sumGroup(CA_GROUPS)
    const totalNca  = sumGroup(NCA_GROUPS)
    const totalAssets  = totalCa + totalNca
    const totalCl   = sumGroup(CL_GROUPS)
    const totalNcl  = sumGroup(NCL_GROUPS)
    const totalLiab    = totalCl + totalNcl
    const staticEq  = accounts.filter(a => a.group === 'Equity' && !a.isDynamic).reduce((s, a) => s + a.balance, 0)
    const totalEq      = staticEq + netProfit
    let y = 720
    const lines: PdfLine[] = []
    const push = (...l: PdfLine[]) => { lines.push(...l); y -= 18 }

    push(...sectionHeader('ASSETS', y))
    push(...sectionHeader('Current Assets', y)); y -= 4
    ;[...CA_GROUPS].forEach(g => {
      const gAcc = accounts.filter(a => a.group === g)
      const gTotal = gAcc.reduce((s, a) => s + bsLive(a), 0)
      if (gTotal !== 0) push(...row(`  ${g}`, fmtKes(gTotal), y))
    })
    push(...row('Total Current Assets', fmtKes(totalCa), y, true))
    y -= 8
    push(...sectionHeader('Non-Current Assets', y)); y -= 4
    accounts.filter(a => NCA_GROUPS.includes(a.group) && a.balance !== 0).forEach(a => {
      push(...row(`  ${a.name}`, a.balance < 0 ? `(${fmtKes(Math.abs(a.balance))})` : fmtKes(a.balance), y))
    })
    push(...row('Total Non-Current Assets (Net)', fmtKes(totalNca), y, true))
    y -= 12
    push(...row('TOTAL ASSETS', fmtKes(totalAssets), y, true))
    y -= 20

    push(...sectionHeader('LIABILITIES', y))
    push(...sectionHeader('Current Liabilities', y)); y -= 4
    ;[...CL_GROUPS].forEach(g => {
      const gTotal = accounts.filter(a => a.group === g).reduce((s, a) => s + bsLive(a), 0)
      if (gTotal !== 0) push(...row(`  ${g}`, fmtKes(gTotal), y))
    })
    push(...row('Total Current Liabilities', fmtKes(totalCl), y, true))
    y -= 8
    accounts.filter(a => NCL_GROUPS.includes(a.group) && a.balance !== 0).forEach(a =>
      push(...row(`  ${a.name}`, fmtKes(a.balance), y))
    )
    push(...row('Total Non-Current Liabilities', fmtKes(totalNcl), y, true))
    y -= 12
    push(...row('TOTAL LIABILITIES', fmtKes(totalLiab), y, true))
    y -= 20

    push(...sectionHeader('EQUITY', y)); y -= 4
    accounts.filter(a => a.group === 'Equity' && !a.isDynamic).forEach(a => {
      push(...row(`  ${a.name}`, fmtKes(a.balance), y))
    })
    push(...row('  Current Year P&L', fmtKes(netProfit), y))
    push(...row('TOTAL EQUITY', fmtKes(totalEq), y, true))
    y -= 16
    push(...row('TOTAL LIABILITIES + EQUITY', fmtKes(totalLiab + totalEq), y, true))

    return hdr(lines, 'BALANCE SHEET', `As at ${REPORT_DATE} · Accrual Basis · IFRS`)
  }

  const buildPLPdf = (): PdfLine[] => {
    let y = 710
    const lines: PdfLine[] = []
    const push = (...l: PdfLine[]) => { lines.push(...l); y -= 18 }

    push(...sectionHeader('REVENUE', y)); y -= 4
    push(...row('  Sales — Products (invoices)', fmtKes(totalRevenueDynamic), y))
    accounts.filter(a => REV_GROUPS.includes(a.group) && !a.isDynamic && a.balance !== 0).forEach(a =>
      push(...row(`  ${a.name}`, fmtKes(a.balance), y))
    )
    if (otherIncome > 0) push(...row('  Other Income', fmtKes(otherIncome), y))
    push(...row('Total Revenue', fmtKes(totalRevenue), y, true))
    y -= 12

    push(...sectionHeader('COST OF SALES', y)); y -= 4
    if (openingStock > 0)   push(...row('  Opening Stock',   fmtKes(openingStock),   y))
    if (totalPurchases > 0) push(...row('  Purchases',       fmtKes(totalPurchases), y))
    if (directExpenses > 0) push(...row('  Direct Expenses', fmtKes(directExpenses), y))
    if (closingStock > 0)   push(...row('  Less: Closing Stock', `(${fmtKes(closingStock)})`, y))
    push(...row('Total Cost of Sales', fmtKes(totalCOGS), y, true))
    y -= 8
    push(...row('GROSS PROFIT', fmtKes(grossProfit), y, true))
    push(...row('Gross Margin', `${totalRevenue > 0 ? Math.round(grossProfit / totalRevenue * 100) : 0}%`, y))
    y -= 16

    push(...sectionHeader('OPERATING EXPENSES', y)); y -= 4
    push(...row('  Salaries & Wages', fmtKes(totalSalaries), y))
    accounts.filter(a => OPEX_GROUPS.includes(a.group) && a.balance !== 0).forEach(a =>
      push(...row(`  ${a.name}`, fmtKes(a.balance), y))
    )
    accounts.filter(a => EMP_GROUPS.includes(a.group) && !a.isDynamic && a.balance !== 0).forEach(a =>
      push(...row(`  ${a.name}`, fmtKes(a.balance), y))
    )
    if (finExpenses > 0) push(...row('  Financial Expenses', fmtKes(finExpenses), y))
    push(...row('Total Operating Expenses', fmtKes(totalOpex), y, true))
    y -= 12

    push(...row('OPERATING PROFIT', fmtKes(operatingProfit), y, true))
    y -= 8
    push(...row('Income Tax (30%)', fmtKes(incomeTax), y))
    y -= 8
    push(...row('NET PROFIT AFTER TAX', fmtKes(netProfit), y, true))

    return hdr(lines, 'PROFIT & LOSS STATEMENT', `For the period ending ${REPORT_DATE} · FY ${FISCAL_YEAR}`)
  }

  const buildJournalPdf = (e: JournalEntry) => hdr([
    ...row('Reference', e.ref,                1, true, 0).map((l, i) => ({ ...l, y: 710 - i * 18 })),
    ...row('Date',      fmtDate(e.date),       2, false, 0).map((l, i) => ({ ...l, y: 692 - i * 18 })),
    ...row('Source',    e.source,              3, false, 0).map((l, i) => ({ ...l, y: 674 - i * 18 })),
    { text: `Description: ${e.description}`, x: 40, y: 656, size: 10 },
    { text: '—'.repeat(75), x: 40, y: 644, size: 10 },
    { text: 'Account', x: 40, y: 628, size: 10, bold: true },
    { text: 'Description', x: 200, y: 628, size: 10, bold: true },
    { text: 'Debit (KSh)', x: 360, y: 628, size: 10, bold: true },
    { text: 'Credit (KSh)', x: 450, y: 628, size: 10, bold: true },
    ...e.lines.flatMap((l, i) => [
      { text: l.account,     x: 40,  y: 610 - i * 22, size: 10 },
      { text: l.description, x: 200, y: 610 - i * 22, size: 9 },
      { text: l.debit  ? fmtKes(l.debit)  : '—', x: 360, y: 610 - i * 22, size: 10 },
      { text: l.credit ? fmtKes(l.credit) : '—', x: 450, y: 610 - i * 22, size: 10 },
    ] as PdfLine[]),
    { text: `Total Debit: ${fmtKes(e.totalDebit)}`,   x: 360, y: 200, size: 10, bold: true },
    { text: `Total Credit: ${fmtKes(e.totalCredit)}`, x: 450, y: 200, size: 10, bold: true },
  ], `JOURNAL ENTRY — ${e.ref}`, `Date: ${fmtDate(e.date)} · Source: ${e.source}`)

  // ── Account type colour ───────────────────────────────────────────────────────
  const typeColor: Record<Account['type'], string> = {
    asset:     '#3B82F6',
    liability: '#EF4444',
    equity:    '#8B5CF6',
    revenue:   '#10B981',
    expense:   '#F59E0B',
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────────

  const TABS = [
    { key: 'invoices'       as MainTab, label: 'Customer Invoices',  count: customerInvoices.length },
    { key: 'bills'          as MainTab, label: 'Vendor Bills',        count: vendorBills.length },
    ...(canViewJournals ? [{ key: 'journals' as MainTab, label: 'Journals', count: journalEntries.length }] : []),
    { key: 'refunds'        as MainTab, label: 'Refunds',             count: refundPayments.length },
    { key: 'coa'            as MainTab, label: 'Chart of Accounts',  count: accounts.length },
    { key: 'gl'             as MainTab, label: 'General Ledger',      count: null },
    { key: 'partner_ledger' as MainTab, label: 'Partner Ledger',      count: null },
    { key: 'pl'             as MainTab, label: 'Profit & Loss',       count: null },
    { key: 'bs'             as MainTab, label: 'Balance Sheet',       count: null },
    { key: 'cashbook'       as MainTab, label: 'Cash Book',           count: null },
  ]

  return (
    <div className="flex flex-col gap-3">

      {/* KPI row */}
      <div className="kpi-grid">
        <StatCard label="Receivables"  value={fmtKes(receivables)}  sub="outstanding"    color="#10B981" icon={<Fa icon={faArrowDown} />}            onClick={() => setTab('invoices')} />
        <StatCard label="Overdue"      value={fmtKes(overdueAmt)}   sub="action needed"  color="#EF4444" icon={<Fa icon={faTriangleExclamation} />} />
        <StatCard label="Payables"     value={fmtKes(payables)}     sub="to vendors"     color="#F59E0B" icon={<Fa icon={faArrowUp} />}               onClick={() => setTab('bills')} />
        <StatCard label="Net Profit"   value={fmtKes(netProfit)}    sub="current year"   color="#8B5CF6" icon={<Fa icon={faChartLine} />}             onClick={() => setTab('pl')} />
        <StatCard label="Collected"    value={fmtKes(collected)}    sub="paid invoices"  color="#3B82F6" icon={<Fa icon={faMoneyBillWave} />} />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setInvFilter('all') }}
            className={`flex items-center gap-1.5 shrink-0 text-[11px] font-medium transition-all rounded-lg cursor-pointer whitespace-nowrap px-3.5 py-1.5 border ${
              tab === t.key
                ? 'bg-[#E8F3FA] border-[#A8D4E8] text-brand-navy font-semibold'
                : 'bg-transparent border-transparent text-t3 hover:text-t1'
            }`}>
            {t.label}
            {t.count !== null && <span className="badge badge-gray text-[9px]">{t.count}</span>}
          </button>
        ))}
      </div>
      <TabContent activeKey={tab}>
      <div className="card overflow-hidden">

        {/* ═══════════════════════════════════════════════════════════════════════
            INVOICES / BILLS
        ════════════════════════════════════════════════════════════════════════ */}
        {(tab === 'invoices' || tab === 'bills') && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
              {['all', 'unpaid', 'paid', 'draft', 'posted', 'overdue', 'cancelled'].map(f => (
                <button key={f} onClick={() => setInvFilter(f)}
                  className={`px-2.5 py-1 rounded-md text-[10px] cursor-pointer capitalize border ${
                    invFilter === f ? 'bg-[#E8F3FA] border-[#A8D4E8] text-brand-navy font-semibold' : 'bg-transparent border-transparent text-t3 hover:text-t1'
                  }`}>
                  {f}
                </button>
              ))}
              <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
                placeholder="Search ref or partner…"
                value={invSearch} onChange={e => setInvSearch(e.target.value)} />
              <div className="ml-auto flex gap-2 items-center">
                {selectedInvIds.size > 0 && (
                  <button className="btn-outline text-[11px]" onClick={() => {
                    const toPrint = filteredInvoices.filter(i => selectedInvIds.has(i.id))
                    printInvoices(toPrint)
                  }}>
                    <Fa icon={faPrint} className="mr-1" />Print {selectedInvIds.size} Selected
                  </button>
                )}
                <ExportButtons
                  title={tab === 'invoices' ? 'Customer Invoices' : 'Vendor Bills'}
                  filename={tab === 'invoices' ? 'invoices' : 'bills'}
                  headers={['Ref', tab === 'invoices' ? 'Customer' : 'Vendor', 'Date', 'Total (KES)', 'Balance (KES)', 'Status']}
                  rows={filteredInvoices.map(inv => [inv.ref, inv.partnerName, fmtDate(inv.date), inv.total, getBalance(inv), inv.status])}
                />
                
              </div>
            </div>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 760 }}>
                <div className="table-head" style={{ gridTemplateColumns: '28px 90px 1.5fr 100px 110px 110px 80px 90px' }}>
                  <span>
                    <input type="checkbox"
                      checked={filteredInvoices.length > 0 && filteredInvoices.every(i => selectedInvIds.has(i.id))}
                      onChange={e => {
                        if (e.target.checked) setSelectedInvIds(new Set(filteredInvoices.map(i => i.id)))
                        else setSelectedInvIds(new Set())
                      }} />
                  </span>
                  <span>Ref</span><span>{tab === 'invoices' ? 'Customer' : 'Vendor'}</span>
                  <span>Date</span><span>Total</span><span>Balance</span><span>Status</span><span>Actions</span>
                </div>
                {filteredInvoices.length === 0
                  ? <p className="py-10 text-center text-xs text-t3">No records found</p>
                  : filteredInvoices.map(inv => {
                    const bal = getBalance(inv)
                    const isSelected = selectedInvIds.has(inv.id)
                    return (
                      <div key={inv.id} className="table-row" style={{ gridTemplateColumns: '28px 90px 1.5fr 100px 110px 110px 80px 90px', background: isSelected ? '#F5F3FF' : undefined }}
                        onClick={() => setViewInv(inv)}>
                        <span onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected}
                            onChange={e => {
                              setSelectedInvIds(prev => {
                                const next = new Set(prev)
                                e.target.checked ? next.add(inv.id) : next.delete(inv.id)
                                return next
                              })
                            }} />
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-purple-600">{inv.ref}</span>
                        <span className="font-medium">{inv.partnerName}</span>
                        <span className="text-[11px] text-t3">{fmtDate(inv.date)}</span>
                        <span className="font-mono text-[11px]">{fmtKes(inv.total)}</span>
                        <span className={`font-mono text-[11px] ${bal > 0 ? 'text-red-500' : 'text-green-600'}`}>
                          {bal > 0 ? fmtKes(bal) : '✓ Paid'}
                        </span>
                        <Badge status={inv.status} />
                        <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                          {inv.status === 'posted' && bal > 0 && (
                            <button className="text-[9px] px-2 py-0.5 rounded bg-green-50 border border-green-200 text-green-700 cursor-pointer"
                              onClick={() => { setViewInv(inv); setPayAmount(String(bal)); setShowPayModal(true) }}>Pay</button>
                          )}
                          {inv.status === 'draft' && (
                            <button className="text-[9px] px-2 py-0.5 rounded bg-red-50 border-none text-red-500 cursor-pointer"
                              onClick={() => setDelId(inv.id)}>Del</button>
                          )}
                          <button className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-t2 cursor-pointer"
                            onClick={() => printInvoices([inv])}>🖨</button>
                        </div>
                      </div>
                    )
                  })
                }
                {filteredInvoices.length > 0 && (
                  <div className="table-row" style={{ gridTemplateColumns: '28px 90px 1.5fr 100px 110px 110px 80px 90px', background: 'var(--bg-surface)', borderTop: '2px solid var(--border-lt)', fontWeight: 700 }}>
                    <span />
                    <span />
                    <span />
                    <span className="text-right text-t3 text-[11px]">{selectedInvIds.size > 0 ? 'Selected Totals:' : 'Totals:'}</span>
                    <span className="font-mono text-[11px] text-t1">{fmtKes(displayInvTotal)}</span>
                    <span className={`font-mono text-[11px] ${displayInvBalance > 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtKes(displayInvBalance)}</span>
                    <span />
                    <span />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            JOURNALS
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'journals' && canViewJournals && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 140 }} type="date"
                value={journalDate} onChange={e => setJournalDate(e.target.value)} />
              <select className="form-select text-[11px] py-1.5" style={{ width: 130 }}
                value={journalSource} onChange={e => setJournalSource(e.target.value)}>
                <option value="all">All sources</option>
                <option value="payroll">Payroll</option>
                <option value="refund">Refund</option>
                <option value="sales">Sales</option>
                <option value="purchase">Purchase</option>
                <option value="manual">Manual</option>
              </select>
              <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
                placeholder="Filter by reference..." value={journalRef}
                onChange={e => setJournalRef(e.target.value)} />
              <div className="ml-auto">
                <ExportButtons
                  title="Journal Entries"
                  filename="journals"
                  headers={['Ref', 'Date', 'Description', 'Source', 'Total (KES)', 'Status']}
                  rows={filteredJournals.map(e => [e.ref, fmtDate(e.date), e.description, e.source, e.lines.reduce((s, l) => s + l.debit, 0), e.status])}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 760 }}>
                <div className="table-head" style={{ gridTemplateColumns: '120px 100px 1.6fr 100px 100px 90px 100px' }}>
                  <span>Ref</span><span>Date</span><span>Description</span><span>Source</span><span>Total</span><span>Status</span><span>Actions</span>
                </div>
                {filteredJournals.length === 0
                  ? <p className="py-10 text-center text-xs text-t3">No journal entries found</p>
                  : filteredJournals.map(e => (
                    <div key={e.id} className="table-row" style={{ gridTemplateColumns: '120px 100px 1.6fr 100px 100px 90px 100px' }}>
                      <span className="font-mono text-[11px] font-semibold text-blue-500">{e.ref}</span>
                      <span className="text-[11px] text-t3">{fmtDate(e.date)}</span>
                      <span>{e.description}</span>
                      <span className="capitalize text-[11px]">{e.source}</span>
                      <span className="font-mono text-[11px]">{fmtKes(e.totalDebit)}</span>
                      <Badge status={e.status} />
                      <div className="flex gap-1">
                        <button className="text-[9px] px-2 py-0.5 rounded bg-[#E8F3FA] border border-[#A8D4E8] text-brand-navy cursor-pointer" onClick={() => setViewJournal(e)}>View</button>
                        <button className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-t2 cursor-pointer"
                          onClick={() => downloadPdf(`${e.ref.replaceAll('/', '-')}.pdf`, buildJournalPdf(e))}>PDF</button>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            REFUNDS
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'refunds' && (
          <>
            <div className="overflow-x-auto">
              <div style={{ minWidth: 800 }}>
                <div className="table-head" style={{ gridTemplateColumns: '100px 110px 1.4fr 110px 130px 110px 110px' }}>
                  <span>Ref</span><span>Date</span><span>Customer</span><span>Amount</span><span>Payment Method</span><span>RMA Ref</span><span>Journal</span>
                </div>
                {refundPayments.length === 0
                  ? <p className="py-12 text-center text-xs text-t3">No refunds recorded yet</p>
                  : refundPayments.map(r => (
                    <div key={r.id} className="table-row" style={{ gridTemplateColumns: '100px 110px 1.4fr 110px 130px 110px 110px' }}>
                      <span className="font-mono text-[11px] font-semibold text-red-600">{r.ref}</span>
                      <span className="text-[11px] text-t3">{fmtDate(r.paymentDate)}</span>
                      <span className="text-[11px]">{r.customerName}</span>
                      <span className="font-mono text-[11px] font-semibold text-red-600">−{fmtKes(r.amount)}</span>
                      <span className="text-[11px] capitalize">{r.paymentMethod.replace('_', ' ')}</span>
                      <span className="font-mono text-[11px] text-t3">{r.rmaRef}</span>
                      <span className="font-mono text-[10px] text-t3">{r.journalEntryId.slice(-8)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
            {refundPayments.length > 0 && (
              <div className="flex justify-end px-4 py-3 text-[11px] font-semibold border-t border-[var(--border-lt)] text-red-600">
                Total Refunded: {fmtKes(refundPayments.reduce((s, r) => s + r.amount, 0))}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            CHART OF ACCOUNTS
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'coa' && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
              <input className="form-input text-[11px] py-1.5" style={{ width: 240 }}
                placeholder="Search code, name, group..."
                value={coaSearch} onChange={e => setCoaSearch(e.target.value)} />
              <div className="flex gap-1 flex-wrap">
                {(['all', 'asset', 'liability', 'equity', 'revenue', 'expense'] as const).map(t => (
                  <button key={t} onClick={() => setCoaTypeFilter(t)}
                    className={`px-2.5 py-1 rounded-md text-[10px] cursor-pointer capitalize border ${
                      coaTypeFilter === t ? 'bg-[#E8F3FA] border-[#A8D4E8] text-brand-navy font-semibold' : 'bg-transparent border-transparent text-t3 hover:text-t1'
                    }`}>{t}</button>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                <button className="btn-primary text-[11px]" onClick={openNewAccount}>+ New Account</button>
              </div>
            </div>

            {/* Accounting Principles notice */}
            <div className="mx-4 my-2 px-3 py-2 rounded-lg text-[11px] bg-[#E8F3FA] border border-[#A8D4E8] text-t2">
              <span className="text-purple-600 font-semibold">Accounting Basis: </span>
              Accrual · Double-entry bookkeeping · IFRS compliant · Kenya Revenue Authority (KRA) VAT 16% ·
              Currency: KES · Fiscal Year: Jan – Dec {FISCAL_YEAR}
            </div>

            <div className="overflow-x-auto">
              <div style={{ minWidth: 820 }}>
                <div className="table-head" style={{ gridTemplateColumns: '72px 2fr 1.1fr 1fr 90px 120px 100px 60px' }}>
                  <span>Code</span><span>Account Name</span><span>Account</span><span>Sub-Account</span><span>Type</span><span>Balance (KSh)</span><span>Status</span><span>Edit</span>
                </div>
                {filteredAccounts.length === 0
                  ? <p className="py-10 text-center text-xs text-t3">No accounts found</p>
                  : filteredAccounts.map(a => {
                    const bal = a.isDynamic
                      ? (a.dynamicKey === 'ar' ? outstandingAR
                       : a.dynamicKey === 'ap' ? outstandingAP
                       : a.dynamicKey === 'revenue' ? totalRevenueDynamic
                       : a.dynamicKey === 'salaries' ? totalSalaries
                       : a.dynamicKey === 'net_profit' ? netProfit
                       : a.balance)
                      : a.balance
                    return (
                      <div key={a.id} className="table-row" style={{ gridTemplateColumns: '72px 2fr 1.1fr 1fr 90px 120px 100px 60px' }}>
                        <span className="font-mono text-[11px] font-semibold text-t3">{a.code}</span>
                        <div>
                          <p className="font-medium text-[12px]">{a.name}</p>
                          {a.isDynamic && <p className="text-[9px] text-t3">⚡ computed</p>}
                        </div>
                        <span className="text-[10px] text-t3">{a.group}</span>
                        <span className="text-[10px] text-t3">{a.subGroup ?? '—'}</span>
                        <span className="text-[10px] font-semibold capitalize" style={{ color: typeColor[a.type] }}>{a.type}</span>
                        <span className={`font-mono text-[11px] ${bal < 0 ? 'text-red-500' : ''}`}>
                          {bal !== 0 ? fmtKes(bal) : <span className="text-t4">—</span>}
                        </span>
                        <span>
                          <span className={`badge ${a.isActive ? 'badge-success' : 'badge-error'}`}>
                            {a.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </span>
                        <button className="text-[9px] px-2 py-0.5 rounded bg-[#E8F3FA] border border-[#A8D4E8] text-brand-navy cursor-pointer"
                          onClick={() => openEditAccount(a)}>Edit</button>
                      </div>
                    )
                  })
                }
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            GENERAL LEDGER
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'gl' && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
              <Select
                value={glAccount}
                onChange={setGlAccount}
                options={[
                  { value: '', label: 'Select an account to view...' },
                  ...accounts.map(a => ({ value: a.name, label: `${a.code} — ${a.name}` })),
                ]}
              />
              <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={glDateFrom} onChange={e => setGlDateFrom(e.target.value)} title="From Date" />
              <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={glDateTo} onChange={e => setGlDateTo(e.target.value)} title="To Date" />
              {glAccount && (
                <span className="text-[11px] text-t3">{filteredGlWithBalance.length} entries</span>
              )}
              <div className="ml-auto">
                <ExportButtons
                  title={`General Ledger — ${glAccount}`}
                  filename={`gl-${glAccount.replace(/\s+/g, '-')}`}
                  headers={['Journal Ref', 'Date', 'Description', 'Source', 'Debit (KES)', 'Credit (KES)', 'Balance (KES)']}
                  rows={filteredGlWithBalance.map(l => [l.entryRef, fmtDate(l.entryDate), l.description || l.entryDesc, l.source, l.debit || '', l.credit || '', l.runningBalance])}
                />
              </div>
            </div>

            {!glAccount ? (
              <div className="py-16 text-center">
                <Fa icon={faBook} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
                <p className="text-xs text-t3">Select an account above to view its ledger</p>
              </div>
            ) : filteredGlWithBalance.length === 0 ? (
              <p className="py-10 text-center text-xs text-t3">No journal lines found for this account or period</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div style={{ minWidth: 720 }}>
                    <div className="table-head" style={{ gridTemplateColumns: '120px 100px 1.4fr 1fr 100px 100px 110px' }}>
                      <span>Journal Ref</span><span>Date</span><span>Description</span><span>Source</span><span>Debit</span><span>Credit</span><span>Balance</span>
                    </div>
                    {filteredGlWithBalance.map((l, i) => (
                      <div key={i} className="table-row" style={{ gridTemplateColumns: '120px 100px 1.4fr 1fr 100px 100px 110px' }}>
                        <span className="font-mono text-[11px] text-blue-500">{l.entryRef}</span>
                        <span className="text-[11px] text-t3">{fmtDate(l.entryDate)}</span>
                        <span className="text-[11px]">{l.description || l.entryDesc}</span>
                        <span className="text-[11px] capitalize text-t3">{l.source}</span>
                        <span className="font-mono text-[11px] text-green-600">{l.debit ? fmtKes(l.debit) : '—'}</span>
                        <span className="font-mono text-[11px] text-red-500">{l.credit ? fmtKes(l.credit) : '—'}</span>
                        <span className={`font-mono text-[11px] font-semibold ${l.runningBalance < 0 ? 'text-red-500' : ''}`}>
                          {fmtKes(l.runningBalance)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-4 py-2 border-t border-[var(--border-lt)] text-right text-[11px] font-semibold">
                  Closing Balance: <span className="font-mono ml-2 text-purple-600">
                    {fmtKes(filteredGlWithBalance.length > 0 ? filteredGlWithBalance[filteredGlWithBalance.length - 1].runningBalance : (glWithBalance[glWithBalance.length - 1]?.runningBalance ?? 0))}
                  </span>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            PARTNER LEDGER
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'partner_ledger' && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
              <Select
                value={plPartner}
                onChange={setPlPartner}
                options={[
                  { value: '', label: 'Select a partner...' },
                  ...Array.from(new Set(allInvoices.map(i => i.partnerName))).map(n => ({ value: n, label: n })),
                ]}
              />
              <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateFrom} onChange={e => setPlDateFrom(e.target.value)} title="From Date" />
              <input type="date" className="form-input text-[11px] py-1.5" style={{ width: 130 }} value={plDateTo} onChange={e => setPlDateTo(e.target.value)} title="To Date" />
              {plPartner && (
                <span className="text-[11px] text-t3">{filteredPartnerTransactions.length} transactions</span>
              )}
              {plPartner && (
                <div className="ml-auto">
                  <ExportButtons
                    title={`Partner Ledger — ${plPartner}`}
                    filename={`partner-ledger-${plPartner.replace(/\s+/g, '-')}`}
                    headers={['Ref', 'Date', 'Type', 'Total (KES)', 'Paid (KES)', 'Outstanding (KES)', 'Status']}
                    rows={filteredPartnerTransactions.map(t => [t.ref, fmtDate(t.date), t.type === 'customer_invoice' ? 'Invoice' : 'Bill', t.total, t.amountPaid, t.outstanding > 0 ? t.outstanding : 0, t.status])}
                  />
                </div>
              )}
            </div>

            {!plPartner ? (
              <div className="py-16 text-center">
                <Fa icon={faUsers} style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
                <p className="text-xs text-t3">Select a partner to view their ledger</p>
              </div>
            ) : filteredPartnerTransactions.length === 0 ? (
              <p className="py-10 text-center text-xs text-t3">No transactions found for this partner or period</p>
            ) : (
              <>
                {/* Partner summary */}
                <div className="px-4 py-3 border-b flex gap-6" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
                  {(() => {
                    const contact = contacts.find(c => c.name === plPartner)
                    const totalInvoiced = filteredPartnerTransactions.filter(t => t.type === 'customer_invoice').reduce((s, t) => s + t.total, 0)
                    const totalBilled   = filteredPartnerTransactions.filter(t => t.type === 'vendor_bill').reduce((s, t) => s + t.total, 0)
                    const outstanding   = partnerTransactions.reduce((s, t) => s + t.outstanding, 0)
                    return (
                      <>
                        <div>
                          <p className="text-[10px] text-t3 mb-0.5">Partner</p>
                          <p className="text-[12px] font-semibold">{plPartner}</p>
                          {contact?.vatNumber && <p className="text-[10px] text-t3">KRA: {contact.vatNumber}</p>}
                        </div>
                        {totalInvoiced > 0 && <div><p className="text-[10px] text-t3 mb-0.5">Total Invoiced (Period)</p><p className="text-[12px] font-mono font-semibold" style={{ color: '#10B981' }}>{fmtKes(totalInvoiced)}</p></div>}
                        {totalBilled > 0 && <div><p className="text-[10px] text-t3 mb-0.5">Total Billed (Period)</p><p className="text-[12px] font-mono font-semibold" style={{ color: '#fec84b' }}>{fmtKes(totalBilled)}</p></div>}
                        <div><p className="text-[10px] text-t3 mb-0.5">Overall Outstanding</p><p className="text-[12px] font-mono font-semibold" style={{ color: outstanding > 0 ? '#EF4444' : '#10B981' }}>{fmtKes(outstanding)}</p></div>
                      </>
                    )
                  })()}
                </div>

                <div className="overflow-x-auto">
                  <div style={{ minWidth: 700 }}>
                    <div className="table-head" style={{ gridTemplateColumns: '90px 100px 80px 110px 110px 110px 90px' }}>
                      <span>Ref</span><span>Date</span><span>Type</span><span>Total</span><span>Paid</span><span>Outstanding</span><span>Status</span>
                    </div>
                    {filteredPartnerTransactions.map(t => (
                      <div key={t.id} className="table-row" style={{ gridTemplateColumns: '90px 100px 80px 110px 110px 110px 90px' }}>
                        <span className="font-mono text-[11px] text-purple-600">{t.ref}</span>
                        <span className="text-[11px] text-t3">{fmtDate(t.date)}</span>
                        <span className={`text-[10px] font-medium ${t.type === 'customer_invoice' ? 'text-green-600' : 'text-amber-500'}`}>
                          {t.type === 'customer_invoice' ? 'Invoice' : 'Bill'}
                        </span>
                        <span className="font-mono text-[11px]">{fmtKes(t.total)}</span>
                        <span className="font-mono text-[11px] text-green-600">{fmtKes(t.amountPaid)}</span>
                        <span className={`font-mono text-[11px] ${t.outstanding > 0 ? 'text-red-500' : 'text-green-600'}`}>
                          {t.outstanding > 0 ? fmtKes(t.outstanding) : '✓ Paid'}
                        </span>
                        <Badge status={t.status} />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            PROFIT & LOSS
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'pl' && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-lt)' }}>
              <span className="text-[11px] text-t3">Period: FY {FISCAL_YEAR} · As at {REPORT_DATE}</span>
              <div className="ml-auto flex gap-2">
                <button className="btn-outline text-[11px]"
                  onClick={() => printPdf(`P&L-${FISCAL_YEAR}.pdf`, buildPLPdf())}>
                  <Fa icon={faPrint} className="mr-1" /> Print
                </button>
                <button className="btn-outline text-[11px]"
                  onClick={() => downloadPdf(`P&L-${FISCAL_YEAR}.pdf`, buildPLPdf())}>
                  <Fa icon={faDownload} className="mr-1" /> PDF
                </button>
                <button className="btn-outline text-[11px]" style={{ color: '#10B981', borderColor: '#6EE7B7' }}
                  onClick={() => exportToExcel(`Profit & Loss FY ${FISCAL_YEAR}`, ['Item', 'Amount (KES)'], plExcelRows, `P&L-${FISCAL_YEAR}`)}>
                  <Fa icon={faDownload} className="mr-1" /> Excel
                </button>
              </div>
            </div>

            <div className="p-6 max-w-2xl mx-auto">
              <div className="text-center mb-6">
                <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>{companySettings.name}</h2>
                <p className="text-[11px] text-t3">PROFIT & LOSS STATEMENT</p>
                <p className="text-[10px] text-t3">For the period ending {REPORT_DATE} · Accrual Basis</p>
              </div>

              <PLSection title="REVENUE">
                <PLRow label="Sales — Products (invoices)" amount={totalRevenueDynamic} indent />
                {accounts.filter(a => REV_GROUPS.includes(a.group) && !a.isDynamic && a.balance !== 0).map(a => (
                  <PLRow key={a.id} label={a.name} amount={a.balance} indent />
                ))}
                {otherIncome > 0 && <PLRow label="Other Income" amount={otherIncome} indent />}
                <PLRow label="Total Revenue" amount={totalRevenue} bold />
              </PLSection>

              <PLSection title="COST OF SALES">
                {openingStock > 0   && <PLRow label="Opening Stock"      amount={openingStock}   indent />}
                {totalPurchases > 0 && <PLRow label="Add: Purchases"     amount={totalPurchases} indent />}
                {directExpenses > 0 && <PLRow label="Add: Direct Expenses" amount={directExpenses} indent />}
                {closingStock > 0   && <PLRow label="Less: Closing Stock" amount={-closingStock}  indent />}
                <PLRow label="Total Cost of Sales" amount={totalCOGS} bold />
              </PLSection>

              <div className="flex justify-between py-3 px-2 rounded-lg my-2" style={{ background: '#DCFCE7', border: '1px solid #A7F3D0' }}>
                <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>GROSS PROFIT</span>
                <div className="text-right">
                  <span className="text-[13px] font-bold font-mono" style={{ color: '#10B981' }}>{fmtKes(grossProfit)}</span>
                  <p className="text-[10px] text-t3">Margin: {totalRevenue > 0 ? Math.round(grossProfit / totalRevenue * 100) : 0}%</p>
                </div>
              </div>

              <PLSection title="OPERATING EXPENSES">
                <PLRow label="Salaries & Wages" amount={totalSalaries} indent />
                {accounts.filter(a => OPEX_GROUPS.includes(a.group) && a.balance !== 0).map(a => (
                  <PLRow key={a.id} label={a.name} amount={a.balance} indent />
                ))}
                {accounts.filter(a => EMP_GROUPS.includes(a.group) && !a.isDynamic && a.balance !== 0).map(a => (
                  <PLRow key={a.id} label={a.name} amount={a.balance} indent />
                ))}
                {finExpenses > 0 && <PLRow label="Financial Expenses" amount={finExpenses} indent />}
                <PLRow label="Total Operating Expenses" amount={totalOpex} bold />
              </PLSection>

              <div className="flex justify-between py-3 px-2 rounded-lg my-2" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>OPERATING PROFIT</span>
                <span className="text-[13px] font-bold font-mono" style={{ color: operatingProfit >= 0 ? '#8B5CF6' : '#EF4444' }}>{fmtKes(operatingProfit)}</span>
              </div>

              <PLSection title="TAX">
                <PLRow label={`Corporation Tax (30% of taxable profit)`} amount={incomeTax} indent />
              </PLSection>

              <div className="flex justify-between py-4 px-3 rounded-xl mt-3" style={{ background: operatingProfit >= 0 ? '#DCFCE7' : '#FEE2E2', border: `1px solid ${operatingProfit >= 0 ? '#A7F3D0' : '#FECACA'}` }}>
                <span className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>NET PROFIT AFTER TAX</span>
                <span className="text-[14px] font-bold font-mono" style={{ color: netProfit >= 0 ? '#10B981' : '#EF4444' }}>{fmtKes(netProfit)}</span>
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            BALANCE SHEET
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'bs' && (() => {
          const totalCa   = sumGroup(CA_GROUPS)
          const totalNca  = sumGroup(NCA_GROUPS)
          const totalAssets  = totalCa + totalNca
          const totalCl   = sumGroup(CL_GROUPS)
          const totalNcl  = sumGroup(NCL_GROUPS)
          const totalLiab    = totalCl + totalNcl
          const staticEq  = accounts.filter(a => a.group === 'Equity' && !a.isDynamic).reduce((s, a) => s + a.balance, 0)
          const totalEq      = staticEq + netProfit
          const balanced     = Math.abs(totalAssets - totalLiab - totalEq) < 1

          // Group rows for each BS section
          // For cash groups use live cashbook totals; everything else uses COA
          const caGroups: Array<{ label: string; total: number }> = [...CA_GROUPS].map(g => ({
            label: g,
            total: g === 'Cash at Bank' ? cashAtBankBS
                 : g === 'Cash in Hand' ? cashInHandBS
                 : accounts.filter(a => a.group === g).reduce((s, a) => s + bsLive(a), 0),
          })).filter(x => x.total !== 0)

          return (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-lt)' }}>
                <span className="text-[11px] text-t3">As at {REPORT_DATE}</span>
                {balanced
                  ? <span className="badge badge-success">✓ Balanced</span>
                  : <span className="badge badge-error">⚠ Out of balance</span>
                }
                <div className="ml-auto flex gap-2">
                  <button className="btn-outline text-[11px]"
                    onClick={() => printPdf(`BalanceSheet-${REPORT_DATE.replace(/ /g,'-')}.pdf`, buildBSPdf())}>
                    <Fa icon={faPrint} className="mr-1" /> Print
                  </button>
                  <button className="btn-outline text-[11px]"
                    onClick={() => downloadPdf(`BalanceSheet-${REPORT_DATE.replace(/ /g,'-')}.pdf`, buildBSPdf())}>
                    <Fa icon={faDownload} className="mr-1" /> PDF
                  </button>
                  <button className="btn-outline text-[11px]" style={{ color: '#10B981', borderColor: '#6EE7B7' }}
                    onClick={() => exportToExcel(`Balance Sheet as at ${REPORT_DATE}`, ['Item', 'Amount (KES)'], bsExcelRows, `BalanceSheet-${FISCAL_YEAR}`)}>
                    <Fa icon={faDownload} className="mr-1" /> Excel
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="text-center mb-6">
                  <h2 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>{companySettings.name}</h2>
                  <p className="text-[11px] text-t3">BALANCE SHEET</p>
                  <p className="text-[10px] text-t3">As at {REPORT_DATE} · Accrual Basis · IFRS</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* LEFT: Assets */}
                  <div>
                    <BSSection title="ASSETS" />
                    <BSSectionSub title="Current Assets">
                      {caGroups.map(g => (
                        <BSRow key={g.label} label={g.label} amount={g.total} indent />
                      ))}
                      <BSRow label="Total Current Assets" amount={totalCa} bold />
                    </BSSectionSub>
                    <BSSectionSub title="Non-Current Assets (PPE)">
                      {accounts.filter(a => NCA_GROUPS.includes(a.group) && a.balance !== 0).map(a =>
                        <BSRow key={a.id} label={`${a.subGroup} — ${a.name}`} amount={a.balance} indent code={a.code} negative={a.balance < 0} />
                      )}
                      <BSRow label="Net Book Value (PPE)" amount={totalNca} bold />
                    </BSSectionSub>
                    <div className="flex justify-between items-center py-3 px-3 mt-2 rounded-lg font-bold text-[13px]"
                      style={{ background: 'rgba(126,200,250,0.1)', border: '1px solid rgba(126,200,250,0.2)' }}>
                      <span className="text-t1">TOTAL ASSETS</span>
                      <span className="font-mono" style={{ color: '#3B82F6' }}>{fmtKes(totalAssets)}</span>
                    </div>
                  </div>

                  {/* RIGHT: Liabilities + Equity */}
                  <div>
                    <BSSection title="LIABILITIES" />
                    <BSSectionSub title="Current Liabilities">
                      {[...CL_GROUPS].map(g => {
                        const t = accounts.filter(a => a.group === g).reduce((s, a) => s + bsLive(a), 0)
                        return t !== 0 ? <BSRow key={g} label={g} amount={t} indent /> : null
                      })}
                      <BSRow label="Total Current Liabilities" amount={totalCl} bold />
                    </BSSectionSub>
                    <BSSectionSub title="Non-Current Liabilities">
                      {accounts.filter(a => NCL_GROUPS.includes(a.group) && a.balance !== 0).map(a =>
                        <BSRow key={a.id} label={a.name} amount={a.balance} indent code={a.code} />
                      )}
                      <BSRow label="Total Non-Current Liabilities" amount={totalNcl} bold />
                    </BSSectionSub>
                    <div className="flex justify-between items-center py-2 px-2 mt-1 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                      <span className="text-[11px] font-semibold text-t2">TOTAL LIABILITIES</span>
                      <span className="font-mono text-[11px] font-semibold" style={{ color: '#EF4444' }}>{fmtKes(totalLiab)}</span>
                    </div>

                    <BSSection title="EQUITY" />
                    <BSSectionSub title="Shareholders' Equity">
                      {accounts.filter(a => a.group === 'Equity' && !a.isDynamic).map(a =>
                        <BSRow key={a.id} label={a.name} amount={a.balance} indent code={a.code} />
                      )}
                      <BSRow label="Current Year P&L" amount={netProfit} indent />
                      <BSRow label="Total Equity" amount={totalEq} bold />
                    </BSSectionSub>

                    <div className="flex justify-between items-center py-3 px-3 mt-2 rounded-lg font-bold text-[13px]"
                      style={{ background: '#E8F3FA', border: `1px solid ${balanced ? '#A7F3D0' : '#FECACA'}` }}>
                      <span style={{ color: 'var(--text-1)' }}>TOTAL LIABILITIES + EQUITY</span>
                      <span className="font-mono" style={{ color: '#8B5CF6' }}>{fmtKes(totalLiab + totalEq)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )
        })()}

        {/* ═══════════════════════════════════════════════════════════════════════
            CASH BOOK  (sub-module of Accounting)
        ════════════════════════════════════════════════════════════════════════ */}
        {tab === 'cashbook' && (
          <div className="px-1">
            <CashbookTab accounts={accounts} />
          </div>
        )}

      </div>
      </TabContent>

      {/* ── Journal detail modal ───────────────────────────────────────────────── */}
      {viewJournal && (
        <Modal title={viewJournal.ref} subtitle={`Journal Entry · ${fmtDate(viewJournal.date)}`} width={700}
          onClose={() => setViewJournal(null)}>
          <div className="flex items-center justify-between">
            <Badge status={viewJournal.status} />
            <div className="flex gap-2">
              <span className="text-xs text-t3">Source: {viewJournal.source}</span>
              <button className="btn-outline text-[10px] py-1 px-2"
                onClick={() => printPdf(`${viewJournal.ref.replaceAll('/', '-')}.pdf`, buildJournalPdf(viewJournal))}>
                Print
              </button>
              <button className="btn-outline text-[10px] py-1 px-2"
                onClick={() => downloadPdf(`${viewJournal.ref.replaceAll('/', '-')}.pdf`, buildJournalPdf(viewJournal))}>
                PDF
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
              <p className="text-[10px] text-t3 mb-1">Description</p>
              <p className="font-semibold">{viewJournal.description}</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
              <p className="text-[10px] text-t3 mb-1">Balance Check</p>
              <p className="font-semibold">Dr {fmtKes(viewJournal.totalDebit)} / Cr {fmtKes(viewJournal.totalCredit)}</p>
            </div>
          </div>
          <Divider label="Journal Lines" />
          <div className="table-head" style={{ gridTemplateColumns: '1.2fr 1.8fr 100px 100px' }}>
            <span>Account</span><span>Description</span><span>Debit</span><span>Credit</span>
          </div>
          {viewJournal.lines.map(l => (
            <div key={l.id} className="table-row" style={{ gridTemplateColumns: '1.2fr 1.8fr 100px 100px' }}>
              <span className="font-semibold text-[11px]">{l.account}</span>
              <span className="text-[11px]">{l.description}</span>
              <span className="font-mono text-[11px]" style={{ color: '#10B981' }}>{l.debit ? fmtKes(l.debit) : '—'}</span>
              <span className="font-mono text-[11px]" style={{ color: '#EF4444' }}>{l.credit ? fmtKes(l.credit) : '—'}</span>
            </div>
          ))}
          <div className="flex justify-end gap-6 text-[11px] font-semibold pt-2 border-t" style={{ borderColor: 'var(--border-lt)' }}>
            <span style={{ color: '#10B981' }}>Total Dr: {fmtKes(viewJournal.totalDebit)}</span>
            <span style={{ color: '#EF4444' }}>Total Cr: {fmtKes(viewJournal.totalCredit)}</span>
          </div>
        </Modal>
      )}

      {/* ── Invoice detail modal ────────────────────────────────────────────────── */}
      {viewInv && !showPayModal && !showNewForm && (
        <Modal title={viewInv.ref}
          subtitle={`${viewInv.type === 'customer_invoice' ? 'Customer Invoice' : 'Vendor Bill'} · ${fmtDate(viewInv.date)}`}
          width={620} onClose={() => setViewInv(null)}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Badge status={viewInv.status} />
            <div className="flex gap-2">
              <button className="btn-outline text-[11px]" onClick={() => printInvoices([viewInv])}>
                <Fa icon={faPrint} className="mr-1" />Print
              </button>
              {viewInv.amountPaid === 0 && (
                <button className="btn-outline text-[11px]" onClick={() => openEditInvoice(viewInv)}>
                  ✏️ Edit
                </button>
              )}
              {viewInv.status === 'draft' && (
                <button className="btn-primary text-[11px]" onClick={() => {
                  if (localInvoices.find(i => i.id === viewInv.id)) {
                    setLocalInvoices(p => p.map(i => i.id === viewInv.id ? { ...i, status: 'posted' } : i))
                    setViewInv(p => p ? { ...p, status: 'posted' } : null)
                    showToast('Invoice posted')
                  } else {
                    postInvoice(viewInv.id)
                    setViewInv(p => p ? { ...p, status: 'posted' } : null)
                  }
                }}>Post Invoice</button>
              )}
              {(viewInv.status === 'posted' || viewInv.status === 'overdue') && getBalance(viewInv) > 0 && (
                <button className="btn-primary text-[11px]" style={{ background: '#12B76A' }}
                  onClick={() => { setPayAmount(String(getBalance(viewInv))); setShowPayModal(true) }}>
                  💰 Register Payment
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
              <p className="text-[10px] text-t3 mb-1">{viewInv.type === 'customer_invoice' ? 'Bill To' : 'Vendor'}</p>
              <p className="font-semibold">{viewInv.partnerName}</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'var(--bg-surface)' }}>
              <p className="text-[10px] text-t3 mb-1">Due Date</p>
              <p className="font-semibold">{fmtDate(viewInv.dueDate)}</p>
            </div>
          </div>
          <Divider label="Lines" />
          <div className="table-head" style={{ gridTemplateColumns: '1.8fr 50px 100px 55px 90px' }}>
            <span>Description</span><span>Qty</span><span>Unit Price</span><span>Tax%</span><span>Subtotal</span>
          </div>
          {viewInv.lines.map(l => (
            <div key={l.id} className="table-row" style={{ gridTemplateColumns: '1.8fr 50px 100px 55px 90px' }}>
              <span>{l.description}</span>
              <span className="font-mono">{l.qty}</span>
              <span className="font-mono">{fmtKes(l.unitPrice)}</span>
              <span className="font-mono text-t3">{l.taxRate}%</span>
              <span className="font-mono font-semibold">{fmtKes(l.subtotal)}</span>
            </div>
          ))}
          <div className="flex justify-end">
            <div className="flex flex-col gap-1.5" style={{ minWidth: 220 }}>
              <div className="flex justify-between text-xs"><span className="text-t3">Subtotal</span><span className="font-mono">{fmtKes(viewInv.subtotal)}</span></div>
              {viewInv.taxTotal > 0 && (
                <div className="flex justify-between text-xs"><span className="text-t3">VAT</span><span className="font-mono">{fmtKes(viewInv.taxTotal)}</span></div>
              )}
              {viewInv.amountPaid > 0 && (
                <div className="flex justify-between text-xs"><span className="text-t3">Paid</span><span className="font-mono" style={{ color: '#10B981' }}>− {fmtKes(viewInv.amountPaid)}</span></div>
              )}
              <div className="flex justify-between text-sm font-bold pt-2 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                <span>Balance Due</span>
                <span className="font-mono" style={{ color: getBalance(viewInv) > 0 ? '#EF4444' : '#10B981' }}>
                  {getBalance(viewInv) > 0 ? fmtKes(getBalance(viewInv)) : '✓ Paid'}
                </span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Payment modal ──────────────────────────────────────────────────────── */}
      {showPayModal && (viewInv || selectedInvIds.size > 0) && (() => {
        const isBulk = !viewInv && selectedInvIds.size > 0;
        const bulkInvoices = isBulk ? filteredInvoices.filter(i => selectedInvIds.has(i.id)) : [];
        const totalOut = isBulk ? bulkInvoices.reduce((s, i) => s + getBalance(i), 0) : getBalance(viewInv!);
        const titleStr = isBulk ? `Pay ${bulkInvoices.length} Invoices/Bills` : `Register Payment`;
        const subStr = isBulk ? `Total Balance: ${fmtKes(totalOut)}` : `${viewInv!.ref} · Balance: ${fmtKes(totalOut)}`;

        return (
          <Modal title={titleStr}
            subtitle={subStr}
            width={420} onClose={() => setShowPayModal(false)}>
          <Field label="Amount (KES)">
            <Input value={payAmount} onChange={setPayAmount} type="number" autoFocus />
          </Field>
          <button className="btn-outline text-[11px] w-full"
            onClick={() => setPayAmount(String(totalOut))}>
            Full amount: {fmtKes(totalOut)}
          </button>
      <Field label="Bank Account">
        <Select value={payBankAccountId} onChange={setPayBankAccountId} options={[
          { value: '', label: '— Select Bank Account —' },
          ...bankAccounts.filter(a => a.active).map(a => ({ value: a.id, label: a.name }))
        ]} />
      </Field>
          <Field label="Payment Method">
            <Select value={payMethod} onChange={setPayMethod} options={[
              { value: 'mpesa',  label: '📱 M-Pesa' },
              { value: 'bank',   label: '🏦 Bank Transfer' },
              { value: 'cash',   label: '💵 Cash' },
              { value: 'cheque', label: '📝 Cheque' },
            ]} />
          </Field>
      {payMethod === 'cheque' && (
        <Field label="Cheque Number">
          <Input value={payReference} onChange={setPayReference} placeholder="e.g. 000123" />
        </Field>
      )}
      {payMethod !== 'cheque' && payMethod !== 'cash' && (
        <Field label="Transaction Reference">
          <Input value={payReference} onChange={setPayReference} placeholder="e.g. MPESA/Bank Ref" />
        </Field>
      )}
          <div className="flex gap-2 justify-end">
            <button className="btn-outline" onClick={() => setShowPayModal(false)}>Cancel</button>
            <button className="btn-primary" style={{ background: '#12B76A' }} onClick={handlePayment}>Confirm Payment</button>
          </div>
        </Modal>
        )
      })()}

      {/* ── New / Edit invoice form ────────────────────────────────────────────── */}
      {showNewForm && (
        <Modal title={editingInvId ? `Edit ${tab === 'invoices' ? 'Invoice' : 'Bill'}` : `New ${tab === 'invoices' ? 'Customer Invoice' : 'Vendor Bill'}`}
          width={640} onClose={resetInvForm}>
          
          {tab === 'bills' && !editingInvId && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleBillFile(e.dataTransfer.files[0] ?? null) }}
              onClick={() => billFileRef.current?.click()}
              className="mb-4"
              style={{
                border: `2px dashed ${dragOver ? '#1B2762' : receiptFile ? '#10B981' : '#D1D5DB'}`,
                borderRadius: 10, padding: '14px 16px', cursor: 'pointer', textAlign: 'center',
                background: dragOver ? '#E8F3FA' : receiptFile ? '#F0FDF4' : '#FAFAFA',
                transition: 'all 0.15s',
              }}>
              <input ref={billFileRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx" onChange={e => handleBillFile(e.target.files?.[0] ?? null)} />
              {isScanning ? (
                <div className="flex flex-col items-center justify-center py-2 gap-2">
                  <svg className="h-6 w-6 animate-spin" style={{ color: '#1B2762' }} viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-[11px] font-bold text-t1 mt-1">AI is scanning bill...</p>
                  <p className="text-[10px] text-t3">Extracting vendor and line items</p>
                </div>
              ) : receiptFile ? (
                <div><div style={{ fontSize: 24 }} className="mb-1">{receiptFile.type.startsWith('image/') ? '🖼️' : '📄'}</div><p className="text-[11px] font-semibold text-green-700">{receiptFile.name}</p><p className="text-[10px] text-t3 mt-0.5">Click to change file</p></div>
              ) : (
                <div><div style={{ fontSize: 24 }} className="mb-1">🔍</div><p className="text-[11px] text-t2 font-medium">Drop vendor bill here to auto-fill</p><p className="text-[10px] text-t3 mt-0.5">Supports image, PDF — AI OCR extraction</p></div>
              )}
            </div>
          )}

          <SearchPicker
            label={tab === 'invoices' ? 'Customer *' : 'Vendor *'}
            placeholder={`Search ${tab === 'invoices' ? 'customer' : 'vendor'} name...`}
            items={tab === 'invoices' ? customers : vendors}
            onSelect={c => { setNewPartnerId(c.id); setNewPartnerName(c.name) }}
            renderItem={c => <div><p className="font-medium text-xs">{c.name}</p><p className="text-[10px] text-t3">{c.email}</p></div>}
          />
          <Field label="Due Date">
            <input className="form-input" type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} />
          </Field>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:'var(--text-2)', userSelect:'none' }}>
            <input type="checkbox" checked={applyVat} onChange={e => {
              const v = e.target.checked
              setApplyVat(v)
            setNewLines(p => p.map(l => ({ ...l, tax: v ? String(companySettings.vatRate) : '0' })))
            }} />
          Apply VAT ({companySettings.vatRate}%) to all lines
          </label>
          <Divider label="Lines" />
          {newLines.map((l, i) => (
            <div key={i} className="grid gap-2 items-end" style={{ gridTemplateColumns: '1.8fr 50px 100px 55px 30px' }}>
              <Field label={i === 0 ? 'Description' : ''}>
                <input className="form-input text-xs" value={l.desc} onChange={e => setNewLines(p => p.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} placeholder="Product or service" />
              </Field>
              <Field label={i === 0 ? 'Qty' : ''}>
                <input className="form-input text-xs text-center" type="number" value={l.qty} onChange={e => setNewLines(p => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
              </Field>
              <Field label={i === 0 ? 'Unit Price' : ''}>
                <input className="form-input text-xs" type="number" value={l.price} onChange={e => setNewLines(p => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="0" />
              </Field>
              <Field label={i === 0 ? 'Tax %' : ''}>
                <input className="form-input text-xs text-center" type="number" value={l.tax} onChange={e => setNewLines(p => p.map((x, j) => j === i ? { ...x, tax: e.target.value } : x))} />
              </Field>
              <button onClick={() => setNewLines(p => p.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F04438', fontSize: 18, paddingBottom: 6 }}>×</button>
            </div>
          ))}
          <button className="btn-outline text-[11px] w-full"
            onClick={() => setNewLines(p => [...p, { desc: '', qty: '1', price: '', tax: applyVat ? '16' : '0' }])}>
            + Add Line
          </button>
          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-outline" onClick={resetInvForm}>Cancel</button>
            <button className="btn-primary" onClick={createDocument}>
              {editingInvId ? `Save Changes` : `Create ${tab === 'invoices' ? 'Invoice' : 'Bill'}`}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Account form modal ─────────────────────────────────────────────────── */}
      {showAccountForm && (
        <Modal title={editAccountId ? 'Edit Account' : 'New Account'} width={520} onClose={() => setShowAccountForm(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account Code *">
              <Input value={accountForm.code} onChange={af('code')} placeholder="e.g. 1005" />
            </Field>
            <Field label="Type *">
              <Select value={accountForm.type} onChange={af('type')} options={[
                { value: 'asset',     label: 'Asset' },
                { value: 'liability', label: 'Liability' },
                { value: 'equity',    label: 'Equity' },
                { value: 'revenue',   label: 'Revenue' },
                { value: 'expense',   label: 'Expense' },
              ]} />
            </Field>
            <div className="col-span-2">
              <Field label="Account Name *">
                <Input value={accountForm.name} onChange={af('name')} placeholder="e.g. Petty Cash" />
              </Field>
            </div>
            <Field label="Account (Group)">
              <Input value={accountForm.group} onChange={af('group')} placeholder="e.g. Inventory - Closing" />
            </Field>
            <Field label="Sub-Account">
              <Input value={accountForm.subGroup ?? ''} onChange={af('subGroup')} placeholder="e.g. Finished Products" />
            </Field>
            <Field label="Opening Balance (KES)">
              <Input value={String(accountForm.balance)} onChange={v => af('balance')(Number(v) || 0)} placeholder="0" type="number" />
            </Field>
            <div className="col-span-2">
              <Field label="Notes">
                <Input value={accountForm.notes ?? ''} onChange={af('notes')} placeholder="Optional description" />
              </Field>
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={accountForm.isActive}
                onChange={e => af('isActive')(e.target.checked)}
                style={{ accentColor: '#1B2762' }} />
              <span className="text-xs">Active account</span>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button className="btn-outline" onClick={() => setShowAccountForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={saveAccount}>{editAccountId ? 'Save Changes' : 'Create Account'}</button>
          </div>
        </Modal>
      )}

      {delId && (
        <Confirm message="Delete this invoice?" detail="Only draft invoices can be deleted."
          onConfirm={() => {
            if (localInvoices.find(i => i.id === delId)) {
              setLocalInvoices(p => p.filter(i => i.id !== delId)); showToast('Invoice deleted')
            } else { deleteInvoice(delId) }
            setDelId(null); setViewInv(null)
          }}
          onCancel={() => setDelId(null)} />
      )}
    </div>
  )
}

// ── P&L sub-components ────────────────────────────────────────────────────────
function PLSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] uppercase tracking-widest font-semibold mb-2 mt-4 text-t3">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}
function PLRow({ label, amount, bold, indent }: { label: string; amount: number; bold?: boolean; indent?: boolean }) {
  return (
    <div
      className={`flex justify-between items-center py-1 px-2 rounded ${
        bold ? 'border-t border-[var(--border-lt)] mt-1 bg-[var(--bg-surface)]' : ''
      }`}
      style={{ paddingLeft: indent ? 20 : 8 }}>
      <span className={bold ? 'text-[12px] font-semibold text-t1' : 'text-[11px] text-t2'}>{label}</span>
      <span className={`font-mono ${bold ? 'text-[12px] font-semibold text-t1' : 'text-[11px] text-t3'}`}>
        {fmtKes(amount)}
      </span>
    </div>
  )
}

// ── Balance Sheet sub-components ──────────────────────────────────────────────
function BSSection({ title }: { title: string }) {
  return (
    <p className="text-[11px] uppercase tracking-wider font-bold mt-4 mb-1 text-t3">
      {title}
    </p>
  )
}
function BSSectionSub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5 mt-2 text-t3">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}
function BSRow({ label, amount, bold, indent, code, negative }: {
  label: string; amount: number; bold?: boolean; indent?: boolean; code?: string; negative?: boolean
}) {
  return (
    <div
      className={`flex justify-between items-center py-1 px-2 rounded ${
        bold ? 'bg-[var(--bg-surface)] border-t border-[var(--border-lt)]' : ''
      }`}
      style={{ paddingLeft: indent ? 16 : 8 }}>
      <div className="flex items-center gap-1.5 min-w-0">
        {code && !bold && <span className="text-[9px] font-mono shrink-0 text-t4">{code}</span>}
        <span className={`truncate ${bold ? 'text-[11px] font-semibold text-t1' : 'text-[10px] text-t3'}`}>{label}</span>
      </div>
      <span
        className={`font-mono ml-2 shrink-0 ${bold ? 'text-[11px] font-semibold' : 'text-[10px]'}`}
        style={{ color: negative ? '#EF4444' : bold ? 'var(--text-1)' : '#6B7280' }}>
        {negative ? `(${fmtKes(Math.abs(amount))})` : fmtKes(amount)}
      </span>
    </div>
  )
}
