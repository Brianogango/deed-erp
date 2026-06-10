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
  faFileAlt,
} from '@fortawesome/free-solid-svg-icons'

import { downloadPdf, printPdf } from '@/lib/pdf'
import type { PdfLine } from '@/lib/pdf'
import { printDeliveryNote } from '@/lib/delivery-note-pdf'

import {
  useApp,
  SaleOrder,
  fmtKes,
  fmtDate,
  LOCATIONS,
  SerialNumber,
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

type SalesOrderLineView = {
  id: string
  productId?: string
  productName?: string
  description?: string
  qty: number
  qtyDelivered?: number
  unitPrice: number
  subtotal: number
  taxRate?: number
  discountPercent?: number
  serials?: SerialNumber[]
}

type SalesOrderView = SaleOrder & {
  ref: string
  customerId?: string
  customerName: string
  date: string
  deliveryDate?: string
  subtotal: number
  taxTotal: number
  total: number
  lines: SalesOrderLineView[]
}

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
    updateDelivery,
    outboundReleases,
    initRelease,
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
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [registeringContact, setRegisteringContact] = useState(false)

  // Per-line delivery quantity tracking (Odoo-style)
  const [deliveryQtys, setDeliveryQtys] = useState<Record<string, number>>({})
  const [savingDelivery, setSavingDelivery] = useState(false)

  // Delivery Note print modal
  const [showDnModal, setShowDnModal] = useState(false)
  const [dnRecipientName, setDnRecipientName] = useState('')
  const [dnRecipientPhone, setDnRecipientPhone] = useState('')
  const [dnRecipientId, setDnRecipientId] = useState('')
  const [dnAddress, setDnAddress] = useState('')
  const [dnNotes, setDnNotes] = useState('')

  const salesOrderViews = saleOrders as unknown as SalesOrderView[]
  const activeOrder = salesOrderViews.find(s => s.id === activeId) ?? null

  // Sync deliveryQtys when active order changes (pre-fill with existing qtyDelivered)
  // NOTE: must be declared AFTER activeOrder to avoid TDZ ReferenceError
  useEffect(() => {
    if (activeOrder?.status === 'confirmed') {
      const init: Record<string, number> = {}
      activeOrder.lines.forEach(l => { init[l.id] = l.qtyDelivered ?? 0 })
      setDeliveryQtys(init)
    }
  }, [activeId, activeOrder?.status])

  const customers = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const sellableProducts = useMemo(
    () => products.filter(p => p.canBeSold && p.isActive),
    [products]
  )

  const filtered = useMemo(() => {
    const result = salesOrderViews.filter(s => {
      const mf = filter === 'all' || s.status === filter
      const ms = !search || s.ref.toLowerCase().includes(search.toLowerCase()) || s.customerName.toLowerCase().includes(search.toLowerCase())
      return mf && ms
    })
    return result
    }, [salesOrderViews, filter, search])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page, PAGE_SIZE])

  const stats = useMemo(
    () => ({
      quotations: salesOrderViews.filter(s => s.status === 'quotation').length,
      confirmed: salesOrderViews.filter(s => s.status === 'confirmed').length,
      toInvoice: salesOrderViews.filter(s => s.status === 'confirmed' || s.status === 'delivered')
        .length,
      revenue: salesOrderViews
        .filter(s => s.status === 'invoiced')
        .reduce((a, s) => a + s.total, 0),
    }),
    [salesOrderViews]
  )

  const openOrder = (id: string) => {
    setActiveId(id)
    setView('form')
  }
  const backToList = () => {
    setView('list')
    setActiveId(null)
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

  const buildCommercialPdfLines = (so: SalesOrderView, documentTitle: string, statusLabel = so.status.toUpperCase()): PdfLine[] => {
    const rows: PdfLine[] = so.lines.flatMap((l, i) => ([
      { text: l.productName ?? l.description ?? 'Item', x: 40, y: 682 - i * 18, size: 9 },
      { text: String(l.qty), x: 320, y: 682 - i * 18, size: 9 },
      { text: String(fmtKes(l.unitPrice)), x: 380, y: 682 - i * 18, size: 9 },
      { text: String(fmtKes(l.subtotal)), x: 470, y: 682 - i * 18, size: 9 },
    ]))
    const totalsY = 680 - so.lines.length * 18

    return [
      { text: CO.name.toUpperCase(), x: 40, y: 810, size: 16, bold: true },
      { text: `${CO.address}  ·  ${CO.phone}`, x: 40, y: 792, size: 9 },
      { text: documentTitle, x: 400, y: 810, size: 14, bold: true },
      { text: so.ref, x: 430, y: 792, size: 11, bold: true },
      { text: `Date: ${fmtDate(so.date)}`, x: 430, y: 778, size: 9 },
      { text: 'BILL TO', x: 40, y: 755, size: 10, bold: true },
      { text: so.customerName, x: 40, y: 740, size: 11, bold: true },
      { text: '─────────────────────────────────────────────────────────', x: 40, y: 718, size: 9 },
      { text: 'PRODUCT', x: 40, y: 700, size: 9, bold: true },
      { text: 'QTY', x: 320, y: 700, size: 9, bold: true },
      { text: 'UNIT PRICE', x: 380, y: 700, size: 9, bold: true },
      { text: 'TOTAL', x: 470, y: 700, size: 9, bold: true },
      ...rows,
      { text: '─────────────────────────────────────────────────────────', x: 40, y: totalsY, size: 9 },
      { text: `Subtotal: ${String(fmtKes(so.subtotal))}`, x: 380, y: totalsY - 20, size: 10 },
      { text: `Tax: ${String(fmtKes(so.taxTotal))}`, x: 380, y: totalsY - 36, size: 10 },
      { text: `TOTAL: ${String(fmtKes(so.total))}`, x: 380, y: totalsY - 52, size: 12, bold: true },
      { text: `Status: ${String(statusLabel)}`, x: 40, y: totalsY - 52, size: 10 },
    ]
  }

  const buildSoPdfLines = (so: SalesOrderView) => buildCommercialPdfLines(so, 'SALE ORDER')
  const buildQuotePdfLines = (so: SalesOrderView) => buildCommercialPdfLines(so, 'QUOTATION', 'QUOTATION')
  const buildProformaPdfLines = (so: SalesOrderView) => buildCommercialPdfLines(so, 'PRO-FORMA INVOICE', 'PRO-FORMA')

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
                          className="btn-secondary flex items-center gap-2 text-xs"
                          onClick={() => downloadPdf(`QUOTE-${activeOrder.ref}.pdf`, buildQuotePdfLines(activeOrder))}
                          disabled={!activeOrder.lines.length}
                          title={!activeOrder.lines.length ? 'Add at least one product before downloading a quote' : 'Download quotation PDF'}
                        >
                          <Fa icon={faDownload} />
                          <span>Quote</span>
                        </button>
                        <button
                          className="btn-secondary flex items-center gap-2 text-xs"
                          onClick={() => downloadPdf(`PROFORMA-${activeOrder.ref}.pdf`, buildProformaPdfLines(activeOrder))}
                          disabled={!activeOrder.lines.length}
                          title={!activeOrder.lines.length ? 'Add at least one product before downloading a pro-forma invoice' : 'Download pro-forma invoice PDF'}
                        >
                          <Fa icon={faFileAlt} />
                          <span>Pro-forma</span>
                        </button>
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
                          onClick={() => setShowCancelConfirm(true)}
                        >
                          <Fa icon={faBan} />
                          <span>Cancel Quote</span>
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
                          disabled={savingDelivery}
                          onClick={async () => {
                            if (!activeOrder.lines.length) { showToast('No line items on this order', 'error'); return }
                            const lines = activeOrder.lines.map(l => ({
                              id: l.id,
                              qtyDelivered: Math.min(l.qty, Math.max(0, deliveryQtys[l.id] ?? 0)),
                            }))
                            const anyDelivered = lines.some(l => l.qtyDelivered > 0)
                            if (!anyDelivered) { showToast('Enter delivered quantities before validating', 'error'); return }
                            setSavingDelivery(true)
                            try {
                              const res = await fetch(`/api/sale-orders/${activeOrder.id}/deliver-lines`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lines }),
                              })
                              const json = await res.json()
                              if (!res.ok) { showToast(json.error ?? 'Failed to save delivery', 'error'); return }
                              if (json.allDelivered) {
                                showToast('All items delivered — order marked as Delivered', 'success')
                                // Also run the existing validateDelivery to handle stock deduction
                                const delivery = deliveries.find(d => d.saleOrderId === activeOrder.id)
                                if (delivery) validateDelivery(delivery.id)
                              } else {
                                showToast('Delivery quantities saved (partial delivery)', 'success')
                              }
                            } catch {
                              showToast('Network error saving delivery', 'error')
                            } finally {
                              setSavingDelivery(false)
                            }
                          }}
                        >
                          <Fa icon={faTruck} />
                          <span>{savingDelivery ? 'Saving…' : 'Validate Delivery'}</span>
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
                    {/* Delivery Note — only available after the quote is confirmed and a delivery exists */}
                    {activeOrder && ['confirmed', 'delivered', 'invoiced'].includes(activeOrder.status) && deliveries.find(d => d.saleOrderId === activeOrder.id) && (
                      <button
                        className="btn-secondary flex items-center gap-1.5 text-xs"
                        title="Print / Download Delivery Note"
                        onClick={() => {
                          const del = deliveries.find(d => d.saleOrderId === activeOrder!.id)!
                          setDnRecipientName(del.recipientName ?? activeOrder?.customerName ?? '')
                          setDnRecipientPhone(del.recipientPhone ?? '')
                          setDnRecipientId(del.recipientIdNumber ?? '')
                          setDnAddress(del.deliveryAddress ?? '')
                          setDnNotes(del.notes ?? '')
                          setShowDnModal(true)
                        }}
                      >
                        <Fa icon={faFileAlt} />
                        <span className="hidden sm:inline">Delivery Note</span>
                      </button>
                    )}
                    {/* Print / Download SO only after quotation confirmation */}
                    {activeOrder && activeOrder.status !== 'quotation' && activeOrder.status !== 'cancelled' && (
                      <>
                        <button className="btn-secondary" onClick={() => printPdf(`SO-${activeOrder.ref}.pdf`, buildSoPdfLines(activeOrder))}>
                          <Fa icon={faPrint} />
                        </button>
                        <button className="btn-secondary" onClick={() => downloadPdf(`SO-${activeOrder.ref}.pdf`, buildSoPdfLines(activeOrder))}>
                          <Fa icon={faDownload} />
                        </button>
                      </>
                    )}
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
                                    Ordered
                                  </th>
                                  {(activeOrder.status === 'confirmed' || activeOrder.status === 'delivered' || activeOrder.status === 'invoiced') && (
                                    <th className="px-4 py-2 text-[10px] font-bold uppercase text-[var(--text-4)] text-center">
                                      Delivered
                                    </th>
                                  )}
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
                                    {(activeOrder.status === 'confirmed' || activeOrder.status === 'delivered' || activeOrder.status === 'invoiced') && (
                                      <td className="px-4 py-3 text-xs text-center">
                                        {activeOrder.status === 'confirmed' ? (
                                          <input
                                            type="number"
                                            min={0}
                                            max={l.qty}
                                            value={deliveryQtys[l.id] ?? 0}
                                            onChange={e => setDeliveryQtys(prev => ({ ...prev, [l.id]: Math.min(l.qty, Math.max(0, Number(e.target.value) || 0)) }))}
                                            className="w-16 text-center border border-[var(--border-lt)] rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
                                          />
                                        ) : (
                                          <span className={`font-semibold ${
                                            (l.qtyDelivered ?? 0) >= l.qty
                                              ? 'text-emerald-600'
                                              : (l.qtyDelivered ?? 0) > 0
                                              ? 'text-amber-500'
                                              : 'text-[var(--text-4)]'
                                          }`}>
                                            {l.qtyDelivered ?? 0}
                                          </span>
                                        )}
                                      </td>
                                    )}
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
              <button className="btn-outline" onClick={() => setShowCreateContact(false)} disabled={registeringContact}>Cancel</button>
              <button className="btn-primary" disabled={registeringContact} onClick={async () => {
                if (!newContactQuery.trim() || !newContactEmail.trim() || !newContactPhone.trim()) {
                  showToast('Please fill in all required fields', 'error')
                  return
                }
                setRegisteringContact(true)
                try {
                  const contact = await addContact({
                    type: 'individual',
                    name: newContactQuery.trim(),
                    email: newContactEmail.trim(),
                    phone: newContactPhone.trim(),
                    address: '',
                    isCustomer: true,
                    isVendor: false,
                    tags: [],
                  })
                  setShowCreateContact(false)
                  setShowNewModal(false)
                  setNewContactQuery('')
                  setNewContactEmail('')
                  setNewContactPhone('')
                  const so = createSaleOrder(contact.id, contact.name)
                  openOrder(so.id)
                } catch {
                  // addContact already shows the error toast
                } finally {
                  setRegisteringContact(false)
                }
              }}>{registeringContact ? 'Registering…' : 'Register & Create Quotation'}</button>
            </div>
          </div>
        </Modal>
      )}
      {showNewModal && (
        <Modal title="New Quotation" onClose={() => setShowNewModal(false)} width={500}>
          <div className="flex flex-col gap-6">
            <p className="text-xs text-[var(--text-3)]">Click a customer below to instantly create a new quotation for them.</p>
            <SearchPicker
              label="Select Customer *"
              placeholder="Search by name or email..."
              items={customers}
              onSelect={(c) => {
                const creditStatus = getCustomerCreditStatus(c.id)
                if (creditStatus.isLocked) {
                  showToast(creditStatus.message, 'error')
                  return
                }
                const so = createSaleOrder(c.id, c.name)
                setShowNewModal(false)
                setNewContactQuery('')
                openOrder(so.id)
              }}
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
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowNewModal(false)}>
                Cancel
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
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center text-[10px] font-bold text-primary-600 flex-shrink-0">
                    {p.name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-xs truncate">{p.name}</p>
                    <p className="text-[10px] text-[var(--text-4)]">
                      {p.category} · {fmtKes(p.salePrice)}
                      {p.stockQty > 0 ? ` · ${p.stockQty} in stock` : ' · out of stock'}
                    </p>
                  </div>
                </div>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity">
                <Input type="number" value={addLineQty} onChange={setAddLineQty} />
              </Field>
              {canEditDiscount && (
                <Field label="Discount %">
                  <Input type="number" value={addLineDiscount} onChange={setAddLineDiscount} />
                </Field>
              )}
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addLineVat}
                onChange={e => setAddLineVat(e.target.checked)}
                className="w-4 h-4 rounded accent-primary-600"
              />
              <span className="text-xs text-[var(--text-2)]">Apply VAT ({companySettings.vatRate}%)</span>
            </label>
            {addLineProduct && (
              <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-lt)] flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-[var(--text-3)]">Line total preview</p>
                  <p className="text-xs text-[var(--text-4)] mt-0.5">
                    {fmtKes(addLineProduct.salePrice)} × {Math.max(1, Number(addLineQty) || 1)}
                    {Number(addLineDiscount) > 0 && ` − ${addLineDiscount}% disc`}
                    {addLineVat && ` + ${companySettings.vatRate}% VAT`}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-primary-600 font-mono">
                  {fmtKes((() => {
                    const qty = Math.max(1, Number(addLineQty) || 1)
                    const disc = Number(addLineDiscount) || 0
                    const sub = Math.round(addLineProduct.salePrice * qty * (1 - disc / 100))
                    const tax = addLineVat ? Math.round(sub * (companySettings.vatRate / 100)) : 0
                    return sub + tax
                  })())}
                </p>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowAddLine(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleAddLine} disabled={!addLineProduct}>
                Add to Order
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* Delete confirm */}
      {showDelConfirm && activeOrder && (
        <Confirm
          message={`Delete ${activeOrder.ref}?`}
          detail="This will permanently remove the order and cannot be undone."
          confirmLabel="Delete"
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
          message={activeOrder.status === 'quotation' ? `Cancel quote ${activeOrder.ref}?` : `Cancel order ${activeOrder.ref}?`}
          detail={activeOrder.status === 'quotation'
            ? 'The quote will no longer be available for confirmation.'
            : 'This will release any reserved stock.'}
          confirmLabel={activeOrder.status === 'quotation' ? 'Cancel Quote' : 'Cancel Order'}
          onConfirm={() => {
            cancelSO(activeOrder.id)
            setShowCancelConfirm(false)
          }}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}

      {/* ── Delivery Note print modal ─────────────────────────────────────────── */}
      {showDnModal && activeId && (() => {
        const del = deliveries.find(d => d.saleOrderId === activeId)
        if (!del) return null
        return (
          <Modal
            title={`Delivery Note — ${del.ref}`}
            onClose={() => setShowDnModal(false)}
            width={480}
          >
            <div className="flex flex-col gap-4">
              <p className="text-xs text-[var(--text-3)]">
                Fill in the recipient details before printing. These will be saved to the delivery record.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Received By (Full Name) *">
                  <Input
                    value={dnRecipientName}
                    onChange={setDnRecipientName}
                    placeholder="e.g. John Kamau"
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={dnRecipientPhone}
                    onChange={setDnRecipientPhone}
                    placeholder="+254…"
                  />
                </Field>
              </div>

              <Field label="ID / Passport No.">
                <Input
                  value={dnRecipientId}
                  onChange={setDnRecipientId}
                  placeholder="National ID or Passport number"
                />
              </Field>

              <Field label="Delivery Address">
                <Input
                  value={dnAddress}
                  onChange={setDnAddress}
                  placeholder="e.g. Westlands, Nairobi"
                />
              </Field>

              <Field label="Notes">
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Accessories included, special instructions…"
                  value={dnNotes}
                  onChange={e => setDnNotes(e.target.value)}
                />
              </Field>

              <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-lt)]">
                <button
                  className="btn-outline text-xs"
                  onClick={() => setShowDnModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn-secondary flex items-center gap-1.5 text-xs"
                  onClick={() => {
                    if (dnRecipientName.trim()) {
                      updateDelivery(del.id, {
                        recipientName: dnRecipientName.trim(),
                        recipientPhone: dnRecipientPhone.trim() || undefined,
                        recipientIdNumber: dnRecipientId.trim() || undefined,
                        deliveryAddress: dnAddress.trim() || undefined,
                        notes: dnNotes.trim() || undefined,
                      })
                    }
                    printDeliveryNote(del, serials, {
                      recipientName: dnRecipientName.trim(),
                      recipientPhone: dnRecipientPhone.trim(),
                      recipientIdNumber: dnRecipientId.trim(),
                      deliveryAddress: dnAddress.trim(),
                      notes: dnNotes.trim(),
                    })
                    setShowDnModal(false)
                  }}
                >
                  <Fa icon={faPrint} /> Print / Download
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

      </div>{/* mod-body */}
    </div>
  )
}
