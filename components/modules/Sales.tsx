'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  faClipboardCheck,
  faCircleCheck,
  faFileInvoiceDollar,
  faMoneyBillWave,
  faPlus,
  faSearch,
  faArrowLeft,
  faDownload,
  faPrint,
  faTrash,
  faCheck,
  faTruck,
  faBan,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons'

import { downloadPdf, printPdf } from '@/lib/pdf'

import {
  useApp,
  SaleOrder,
  fmtKes,
  fmtDate,
  LOCATIONS,
  SerialNumber,
  Contact,
} from '@/lib/store'
import {
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Confirm,
  StatCard,
  PanelHeader,
  StatusStepper,
  SearchPicker,
  Divider,
  ModuleSkeleton,
} from '@/components/ui'
import { Fa } from '@/components/icons'
import SalesDashboard from './SalesDashboard'
import RepPerformance from './RepPerformance'
import CRM from './CRM'
import AfterSales from './AfterSales'
import { CO } from '@/lib/company'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

const SO_STEPS = ['quotation', 'confirmed', 'delivered', 'invoiced']

type SalesMode = 'list' | 'crm' | 'dashboard' | 'reps' | 'after_sales'

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function Sales() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <SalesContent />
    </Suspense>
  )
}

function SalesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    saleOrders,
    contacts,
    products,
    serials,
    invoices,
    deliveries,
    createSaleOrder,
    updateSaleOrder,
    confirmSO,
    addSOLine,
    removeSOLine,
    assignSerialToSOLine,
    addContact,
    createInvoiceFromSO,
    validateDelivery,
    deleteSaleOrder,
    showToast,
    getStockByLocation,
    resetSOToDraft,
    cancelSO,
    getCustomerCreditStatus,
    users,
    currentUserId,
    systemSettings,
    companySettings,
    bankAccounts,
    confirmDeliveryWithStockDeduction,
  } = useApp()

  const defaultMode: SalesMode = 'dashboard'
  const queryMode = searchParams.get('tab') as SalesMode | null
  const initialMode = queryMode ?? defaultMode

  const [mode, setLocalMode] = useState<SalesMode>(initialMode)

  const setMode = (newMode: SalesMode) => {
    setLocalMode(newMode)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newMode)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const urlMode = searchParams.get('tab') as SalesMode | null
    if (urlMode && urlMode !== mode) {
      setLocalMode(urlMode)
    }
  }, [searchParams, mode])

  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'director'
  const canEditDiscount = isAdmin || !systemSettings.salesDiscountControl

  const [view, setView] = useState<'list' | 'form'>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  // Reset to first page when filter/search changes
  const setFilterAndReset = (v: string) => { setFilter(v); setPage(1) }
  const setSearchAndReset = (v: string) => { setSearch(v); setPage(1) }
  const PAGE_SIZE = 50
  const [showNewModal, setShowNewModal] = useState(false)
  const [showDelConfirm, setShowDelConfirm] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)
  const [addLineQty, setAddLineQty] = useState('1')
  const [addLineDiscount, setAddLineDiscount] = useState('0')
  const [addLineVat, setAddLineVat] = useState(false)
  const [addLineProduct, setAddLineProduct] = useState<(typeof products)[0] | null>(null)
  const [printMode, setPrintMode] = useState<'quote' | 'proforma' | 'delivery_note' | null>(null)

  // New contact modal state
  const [newContactQuery, setNewContactQuery] = useState('')
  const [newContactSelected, setNewContactSelected] = useState<Contact | null>(null)
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')

  const activeOrder = saleOrders.find(s => s.id === activeId) ?? null
  const customers = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const sellableProducts = useMemo(
    () => products.filter(p => p.canBeSold && p.isActive),
    [products]
  )

  const filtered = useMemo(() => {
    const result = saleOrders.filter(s => {
      const mf = filter === 'all' || s.status === filter
      const ms = !search || s.ref.toLowerCase().includes(search.toLowerCase()) || s.customerName.toLowerCase().includes(search.toLowerCase())
      return mf && ms
    })
    return result
  }, [saleOrders, filter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page, PAGE_SIZE])

  const stats = useMemo(
    () => ({
      quotations: saleOrders.filter(s => s.status === 'quotation').length,
      confirmed: saleOrders.filter(s => s.status === 'confirmed').length,
      toInvoice: saleOrders.filter(s => s.status === 'confirmed' || s.status === 'delivered')
        .length,
      revenue: saleOrders
        .filter(s => s.status === 'invoiced')
        .reduce((a, s) => a + s.total, 0),
    }),
    [saleOrders]
  )

  const openOrder = (id: string) => {
    setActiveId(id)
    setView('form')
  }
  const backToList = () => {
    setView('list')
    setActiveId(null)
  }

  const handleCreate = () => {
    if (!newContactSelected) {
      showToast('Please select or create a contact', 'error')
      return
    }
    const creditStatus = getCustomerCreditStatus(newContactSelected.id)
    if (creditStatus.isLocked) {
      showToast(creditStatus.message, 'error')
      return
    }
    const so = createSaleOrder(newContactSelected.id, newContactSelected.name)
    setShowNewModal(false)
    setNewContactQuery('')
    setNewContactSelected(null)
    openOrder(so.id)
  }

  const handleAddLine = () => {
    if (!addLineProduct || !activeId) return
    const qty = Math.max(0, Number(addLineQty) || 0)
    const disc = Number(addLineDiscount) || 0
    if (qty > 0 && addLineProduct.unit !== 'service') {
      const locs = getStockByLocation(addLineProduct.id)
      const availableForSales = locs.shop + locs.warehouse
      if (availableForSales < qty) {
        showToast(`Only ${availableForSales} units available for sales stock out`, 'error')
        return
      }
    }
    addSOLine(activeId, addLineProduct, qty, disc, addLineVat ? companySettings.vatRate : 0)
    setShowAddLine(false)
    setAddLineProduct(null)
    setAddLineQty('1')
    setAddLineDiscount('0')
    setAddLineVat(false)
  }

  const buildSoPdfLines = (so: SaleOrder) => {
    const lines = [
      { text: CO.name.toUpperCase(), x: 40, y: 810, size: 16, bold: true },
      { text: `${CO.address}  ·  ${CO.phone}`, x: 40, y: 792, size: 9 },
      { text: 'SALE ORDER', x: 430, y: 810, size: 14, bold: true },
      { text: so.ref, x: 430, y: 792, size: 11, bold: true },
      { text: `Date: ${fmtDate(so.date)}`, x: 430, y: 778, size: 9 },
      { text: 'BILL TO', x: 40, y: 755, size: 10, bold: true },
      { text: so.customerName, x: 40, y: 740, size: 11, bold: true },
      { text: '─────────────────────────────────────────────────────────', x: 40, y: 718, size: 9 },
      { text: 'PRODUCT', x: 40, y: 700, size: 9, bold: true },
      { text: 'QTY', x: 320, y: 700, size: 9, bold: true },
      { text: 'UNIT PRICE', x: 380, y: 700, size: 9, bold: true },
      { text: 'TOTAL', x: 470, y: 700, size: 9, bold: true },
      ...so.lines.map((l, i) => ([
        { text: l.productName, x: 40, y: 682 - i * 18, size: 9 },
        { text: String(l.qty), x: 320, y: 682 - i * 18, size: 9 },
        { text: fmtKes(l.unitPrice), x: 380, y: 682 - i * 18, size: 9 },
        { text: fmtKes(l.subtotal), x: 470, y: 682 - i * 18, size: 9 },
      ])).flat(),
      { text: '─────────────────────────────────────────────────────────', x: 40, y: 680 - so.lines.length * 18, size: 9 },
      { text: `Subtotal: ${fmtKes(so.subtotal)}`, x: 380, y: 660 - so.lines.length * 18, size: 10 },
      { text: `Tax: ${fmtKes(so.taxTotal)}`, x: 380, y: 644 - so.lines.length * 18, size: 10 },
      { text: `TOTAL: ${fmtKes(so.total)}`, x: 380, y: 628 - so.lines.length * 18, size: 12, bold: true },
      { text: `Status: ${so.status.toUpperCase()}`, x: 40, y: 628 - so.lines.length * 18, size: 10 },
    ]
    return lines
  }

  return (
    <div className="mod-page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#3B82F615', color: '#3B82F6' }}>
            <Fa icon={faClipboardCheck} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-extrabold text-text-1">Sales &amp; CRM</h1>
              <span className="badge badge-gray text-[9px]">{stats.quotations + stats.confirmed + stats.toInvoice} active</span>
            </div>
            <p className="text-[10px] text-text-3 mt-0.5">Quotations, orders &amp; customer relations</p>
          </div>
        </div>
        <button onClick={() => setShowNewModal(true)} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Fa icon={faPlus} />
          <span className="hidden sm:inline">New Quotation</span>
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 stat-grid-4 border-b border-border-lt bg-surface">
        <StatCard label="Quotations" value={stats.quotations} sub="Active quotes pending" color="#F59E0B" icon={<Fa icon={faClipboardCheck} />} />
        <StatCard label="Confirmed" value={stats.confirmed} sub="Orders to be delivered" color="#3B82F6" icon={<Fa icon={faCircleCheck} />} />
        <StatCard label="To Invoice" value={stats.toInvoice} sub="Ready for billing" color="#8B5CF6" icon={<Fa icon={faFileInvoiceDollar} />} />
        <StatCard label="Revenue" value={fmtKes(stats.revenue)} sub="Invoiced this month" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="mod-tabs">
        {(
          [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'list', label: 'All Orders' },
            { id: 'crm', label: 'CRM' },
            { id: 'reps', label: 'Rep Performance' },
            { id: 'after_sales', label: 'After Sales' },
          ] as const
        ).map(t => (
          <button key={t.id} onClick={() => setMode(t.id)} className={`mod-tab ${mode === t.id ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mod-body">
      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden m-3 sm:m-4">
        {mode === 'dashboard' ? (
          <SalesDashboard />
        ) : mode === 'list' ? (
          <div className="flex flex-col">
            {view === 'list' ? (
              <>
                <div className="p-4 border-b border-[var(--border-lt)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Search orders or customers..."
                        className="form-input pl-9"
                        value={search}
                        onChange={e => setSearchAndReset(e.target.value)}
                      />
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]">
                        <Fa icon={faSearch} />
                      </div>
                    </div>
                    <select
                      className="form-select w-32"
                      value={filter}
                      onChange={e => setFilterAndReset(e.target.value)}
                    >
                      <option value="all">All Status</option>
                      <option value="quotation">Quotation</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="delivered">Delivered</option>
                      <option value="invoiced">Invoiced</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                          Order No
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)]">
                          Date
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
                      {paginated.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-14 text-center">
                            {saleOrders.length === 0 ? (
                              <div className="flex flex-col items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center">
                                  <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-[var(--text-2)]">No sale orders yet</p>
                                  <p className="text-[11px] text-[var(--text-4)] mt-0.5">Create your first sale order to start tracking sales</p>
                                </div>
                                <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowNewModal(true)}>+ New Sale Order</button>
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--text-4)]">No orders match your filter</p>
                            )}
                          </td>
                        </tr>
                      )}
                      {paginated.map(s => (
                        <tr
                          key={s.id}
                          onClick={() => openOrder(s.id)}
                          className="hover:bg-[var(--bg-surface)] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 text-xs font-bold text-primary-600">
                            {s.ref}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--text-1)]">
                            {s.customerName}
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--text-3)]">
                            {fmtDate(s.date)}
                          </td>
                          <td className="px-4 py-3 text-xs font-bold text-[var(--text-1)] text-right">
                            {fmtKes(s.total)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              status={
                                s.status === 'invoiced'
                                  ? 'active'
                                  : s.status === 'quotation'
                                  ? 'pending'
                                  : 'active'
                              }
                              label={s.status}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-lt)] text-xs text-[var(--text-3)]">
                    <span>{filtered.length} orders · page {page} of {totalPages}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="px-2.5 py-1 rounded border border-[var(--border-lt)] disabled:opacity-40 hover:bg-[var(--bg-surface)] transition-colors">‹ Prev</button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                        return (
                          <button key={p} onClick={() => setPage(p)}
                            className={`px-2.5 py-1 rounded border transition-colors ${p === page ? 'bg-primary-600 text-white border-primary-600' : 'border-[var(--border-lt)] hover:bg-[var(--bg-surface)]'}`}>
                            {p}
                          </button>
                        )
                      })}
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="px-2.5 py-1 rounded border border-[var(--border-lt)] disabled:opacity-40 hover:bg-[var(--bg-surface)] transition-colors">Next ›</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col">
                <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between">
                  <button onClick={backToList} className="btn-outline flex items-center gap-2">
                    <Fa icon={faArrowLeft} />
                    <span>Back to List</span>
                  </button>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status-based action buttons */}
                    {activeOrder?.status === 'quotation' && (
                      <>
                        <button
                          className="btn-primary flex items-center gap-2 text-xs"
                          onClick={() => {
                            if (!activeOrder.lines.length) { showToast('Add at least one product before confirming', 'error'); return }
                            confirmSO(activeOrder.id)
                          }}
                        >
                          <Fa icon={faCheck} />
                          <span>Confirm Order</span>
                        </button>
                        <button
                          className="btn-danger flex items-center gap-2 text-xs"
                          onClick={() => setShowDelConfirm(true)}
                        >
                          <Fa icon={faTrash} />
                          <span>Delete</span>
                        </button>
                      </>
                    )}
                    {activeOrder?.status === 'confirmed' && (
                      <>
                        <button
                          className="btn-primary flex items-center gap-2 text-xs"
                          onClick={() => {
                            const delivery = deliveries.find(d => d.saleOrderId === activeOrder.id)
                            if (delivery) {
                              validateDelivery(delivery.id)
                            } else {
                              showToast('No delivery found for this order', 'error')
                            }
                          }}
                        >
                          <Fa icon={faTruck} />
                          <span>Validate Delivery</span>
                        </button>
                        <button
                          className="btn-outline flex items-center gap-2 text-xs"
                          onClick={() => resetSOToDraft(activeOrder.id)}
                        >
                          <Fa icon={faRotateLeft} />
                          <span>Reset to Draft</span>
                        </button>
                        <button
                          className="btn-danger flex items-center gap-2 text-xs"
                          onClick={() => setShowCancelConfirm(true)}
                        >
                          <Fa icon={faBan} />
                          <span>Cancel</span>
                        </button>
                      </>
                    )}
                    {activeOrder?.status === 'delivered' && (
                      <button
                        className="btn-primary flex items-center gap-2 text-xs"
                        onClick={() => {
                          const inv = createInvoiceFromSO(activeOrder.id)
                          if (inv?.id) showToast(`Invoice ${inv.ref} created`, 'success')
                        }}
                      >
                        <Fa icon={faFileInvoiceDollar} />
                        <span>Create Invoice</span>
                      </button>
                    )}
                    {/* Print / Download always visible */}
                    <button className="btn-secondary" onClick={() => activeOrder && printPdf(`SO-${activeOrder.ref}.pdf`, buildSoPdfLines(activeOrder))}>
                      <Fa icon={faPrint} />
                    </button>
                    <button className="btn-secondary" onClick={() => activeOrder && downloadPdf(`SO-${activeOrder.ref}.pdf`, buildSoPdfLines(activeOrder))}>
                      <Fa icon={faDownload} />
                    </button>
                  </div>
                </div>
                <div className="p-6">
                  {activeOrder && (
                    <div className="flex flex-col gap-8">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-bold text-[var(--text-1)]">
                            Order {activeOrder.ref}
                          </h2>
                          <p className="text-xs text-[var(--text-3)]">
                            Customer: {activeOrder.customerName}
                          </p>
                        </div>
                        <StatusStepper steps={SO_STEPS} current={activeOrder.status} />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 flex flex-col gap-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-[var(--text-1)]">Line Items</h3>
                            <button
                              onClick={() => setShowAddLine(true)}
                              className="text-xs font-bold text-primary-600 hover:underline"
                            >
                              + Add Product
                            </button>
                          </div>
                          <div className="overflow-x-auto border border-[var(--border-lt)] rounded-2xl">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                                  <th className="px-4 py-2 text-[10px] font-bold uppercase text-[var(--text-4)]">
                                    Product
                                  </th>
                                  <th className="px-4 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center">
                                    Qty
                                  </th>
                                  <th className="px-4 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right">
                                    Price
                                  </th>
                                  <th className="px-4 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-right">
                                    Total
                                  </th>
                                  <th className="px-4 py-2 w-10"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border-lt)]">
                                {activeOrder.lines.map(l => (
                                  <tr key={l.id}>
                                    <td className="px-4 py-3 text-xs text-[var(--text-1)]">
                                      {l.productName}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-center">{l.qty}</td>
                                    <td className="px-4 py-3 text-xs text-right">
                                      {fmtKes(l.unitPrice)}
                                    </td>
                                    <td className="px-4 py-3 text-xs font-bold text-right">
                                      {fmtKes(l.subtotal)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                      <button
                                        onClick={() => removeSOLine(activeOrder.id, l.id)}
                                        className="text-red-500 hover:text-red-700"
                                      >
                                        <Fa icon={faTrash} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="flex flex-col gap-4">
                          <div className="card p-5 bg-[var(--bg-surface)] border-[var(--border-lt)]">
                            <h3 className="text-sm font-bold text-[var(--text-1)] mb-4">
                              Order Summary
                            </h3>
                            <div className="flex flex-col gap-3">
                              <div className="flex justify-between text-xs">
                                <span className="text-[var(--text-3)]">Subtotal</span>
                                <span className="font-bold">{fmtKes(activeOrder.subtotal)}</span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-[var(--text-3)]">Tax Total</span>
                                <span className="font-bold">{fmtKes(activeOrder.taxTotal)}</span>
                              </div>
                              <Divider />
                              <div className="flex justify-between text-sm">
                                <span className="font-bold text-[var(--text-1)]">Total</span>
                                <span className="font-extrabold text-primary-600">
                                  {fmtKes(activeOrder.total)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : mode === 'crm' ? (
          <CRM />
        ) : mode === 'reps' ? (
          <RepPerformance />
        ) : (
          <AfterSales />
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreateContact && (
        <Modal title="Quick Register Customer" onClose={() => setShowCreateContact(false)} width={500}>
          <div className="flex flex-col gap-4">
            <Field label="Customer/Company Name" required>
              <Input value={newContactQuery} onChange={setNewContactQuery} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" required>
                <Input type="email" value={newContactEmail} onChange={setNewContactEmail} />
              </Field>
              <Field label="Phone" required>
                <Input type="tel" value={newContactPhone} onChange={setNewContactPhone} />
              </Field>
            </div>
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowCreateContact(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                if (!newContactQuery || !newContactEmail || !newContactPhone) {
                  showToast('Please fill in all required fields', 'error')
                  return
                }
                const contact = addContact(newContactQuery, newContactEmail, newContactPhone)
                setNewContactSelected(contact)
                setShowCreateContact(false)
                showToast('Customer registered successfully', 'success')
              }}>Register & Select</button>
            </div>
          </div>
        </Modal>
      )}
      {showNewModal && (
        <Modal title="New Quotation" onClose={() => { setShowNewModal(false); setNewContactSelected(null) }} width={500}>
          <div className="flex flex-col gap-6">
            <SearchPicker
              label="Select Customer *"
              placeholder="Search by name or email..."
              items={customers}
              onSelect={(c) => { setNewContactSelected(c); showToast(`${c.name} selected`, 'success') }}
              onCreateNew={(query) => {
                setNewContactQuery(query)
                setShowCreateContact(true)
              }}
              createNewLabels={{ title: 'Add New Customer', subtitle: 'Not in the system? Register now' }}
              renderItem={c => (
                <div>
                  <p className="font-bold text-xs">{c.name}</p>
                  <p className="text-[10px] text-[var(--text-4)]">{c.email || c.phone || 'No contact info'}</p>
                </div>
              )}
            />
            {newContactSelected && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 border border-green-200">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm">
                  {newContactSelected.name.charAt(0)}
                </div>
                <div>
                  <p className="text-xs font-bold text-green-800">{newContactSelected.name}</p>
                  <p className="text-[10px] text-green-600">Selected ✓</p>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => { setShowNewModal(false); setNewContactSelected(null) }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreate} disabled={!newContactSelected}>
                Create Quotation
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showAddLine && (
        <Modal title="Add Product" onClose={() => setShowAddLine(false)} width={500}>
          <div className="flex flex-col gap-4">
            <SearchPicker
              label="Product *"
              placeholder="Search product..."
              items={sellableProducts}
              onSelect={setAddLineProduct}
              renderItem={p => (
                <div className="flex items-center gap-3">
                  <span className="text-xl">{p.image || '📦'}</span>
                  <div>
                    <p className="font-bold text-xs">{p.name}</p>
                    <p className="text-[10px] text-[var(--text-4)]">
                      {p.category} · {fmtKes(p.salePrice)}
                    </p>
                  </div>
                </div>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity">
                <Input type="number" value={addLineQty} onChange={setAddLineQty} />
              </Field>
              <Field label="Discount %">
                <Input type="number" value={addLineDiscount} onChange={setAddLineDiscount} />
              </Field>
            </div>
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleAddLine}>
                Add to Order
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* Delete confirm */}
      {showDelConfirm && activeOrder && (
        <Confirm
          title="Delete Order"
          message={`Are you sure you want to permanently delete ${activeOrder.ref}? This cannot be undone.`}
          onConfirm={() => {
            deleteSaleOrder(activeOrder.id)
            setShowDelConfirm(false)
            backToList()
          }}
          onCancel={() => setShowDelConfirm(false)}
        />
      )}
      {/* Cancel confirm */}
      {showCancelConfirm && activeOrder && (
        <Confirm
          title="Cancel Order"
          message={`Are you sure you want to cancel ${activeOrder.ref}? This will release any reserved stock.`}
          onConfirm={() => {
            cancelSO(activeOrder.id)
            setShowCancelConfirm(false)
          }}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
      </div>{/* mod-body */}
    </div>
  )
}
