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
  const [showNewModal, setShowNewModal] = useState(false)
  const [showDelConfirm, setShowDelConfirm] = useState(false)
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

  const filtered = useMemo(
    () =>
      saleOrders.filter(s => {
        const mf = filter === 'all' || s.status === filter
        const ms =
          !search ||
          s.ref.toLowerCase().includes(search.toLowerCase()) ||
          s.customerName.toLowerCase().includes(search.toLowerCase())
        return mf && ms
      }),
    [saleOrders, filter, search]
  )

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
    <div className="flex flex-col gap-6 pb-10">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-[var(--text-1)]">Sales & CRM</h1>
          <p className="text-xs text-[var(--text-3)]">Manage quotations, orders, and customer relations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewModal(true)}
            className="flex-1 sm:flex-none btn-primary flex items-center justify-center gap-2"
          >
            <Fa icon={faPlus} />
            <span>New Quotation</span>
          </button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Quotations"
          value={stats.quotations}
          sub="Active quotes pending"
          color="#F59E0B"
          icon={<Fa icon={faClipboardCheck} />}
        />
        <StatCard
          label="Confirmed"
          value={stats.confirmed}
          sub="Orders to be delivered"
          color="#3B82F6"
          icon={<Fa icon={faCircleCheck} />}
        />
        <StatCard
          label="To Invoice"
          value={stats.toInvoice}
          sub="Ready for billing"
          color="#8B5CF6"
          icon={<Fa icon={faFileInvoiceDollar} />}
        />
        <StatCard
          label="Revenue"
          value={fmtKes(stats.revenue)}
          sub="Invoiced this month"
          color="#10B981"
          icon={<Fa icon={faMoneyBillWave} />}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {(
          [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'list', label: 'All Orders' },
            { id: 'crm', label: 'CRM' },
            { id: 'reps', label: 'Rep Performance' },
            { id: 'after_sales', label: 'After Sales' },
          ] as const
        ).map(t => (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            className={`
              px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap
              ${
                mode === t.id
                  ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                  : 'bg-white text-[var(--text-3)] hover:bg-[var(--bg-surface)] border border-[var(--border-lt)]'
              }
            `}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
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
                        onChange={e => setSearch(e.target.value)}
                      />
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]">
                        <Fa icon={faSearch} />
                      </div>
                    </div>
                    <select
                      className="form-select w-32"
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
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
                      {filtered.map(s => (
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
              </>
            ) : (
              <div className="flex flex-col">
                <div className="p-4 border-b border-[var(--border-lt)] flex items-center justify-between">
                  <button onClick={backToList} className="btn-outline flex items-center gap-2">
                    <Fa icon={faArrowLeft} />
                    <span>Back to List</span>
                  </button>
                  <div className="flex items-center gap-2">
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
        <Modal title="New Quotation" onClose={() => setShowNewModal(false)} width={500}>
          <div className="flex flex-col gap-6">
            <SearchPicker
              label="Select Customer *"
              placeholder="Search by name or email..."
              items={customers}
              onSelect={setNewContactSelected}
              onCreateNew={(query) => {
                setNewContactQuery(query)
                setShowCreateContact(true)
              }}
              createNewLabels={{ title: 'Add New Customer', subtitle: 'Not in the system? Register now' }}
              renderItem={c => (
                <div>
                  <p className="font-bold text-xs">{c.name}</p>
                  <p className="text-[10px] text-[var(--text-4)]">{c.email}</p>
                </div>
              )}
            />
            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-lt)]">
              <button className="btn-outline" onClick={() => setShowNewModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreate}>
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
    </div>
  )
}
