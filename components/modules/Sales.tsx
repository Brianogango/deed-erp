'use client'
import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useApp, SaleOrder, fmtKes, fmtDate, LOCATIONS, SerialNumber, Contact } from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, StatCard, PanelHeader, StatusStepper, SearchPicker, Divider, ModuleSkeleton } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faClipboardCheck, faCircleCheck, faFileInvoiceDollar, faMoneyBillWave } from '@fortawesome/free-solid-svg-icons'
import SalesDashboard from './SalesDashboard'
import RepPerformance from './RepPerformance'
import CRM from './CRM'
import AfterSales from './AfterSales'
import { CO } from '@/lib/company'

const SO_STEPS = ['quotation', 'confirmed', 'delivered', 'invoiced']

type SalesMode = 'list' | 'crm' | 'dashboard' | 'reps' | 'after_sales'

export default function Sales() {
  return (
    <Suspense fallback={
      <ModuleSkeleton />
    }>
      <SalesContent />
    </Suspense>
  )
}

function SalesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const {
    saleOrders, contacts, products, serials, invoices, deliveries,
    createSaleOrder, updateSaleOrder, confirmSO, addSOLine, removeSOLine,
    assignSerialToSOLine, addContact,
    createInvoiceFromSO, validateDelivery, deleteSaleOrder, showToast, getStockByLocation,
    resetSOToDraft, cancelSO, getCustomerCreditStatus,
    users, currentUserId, systemSettings, companySettings, bankAccounts,
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
  const isAdmin = ['director', 'admin_officer'].includes(currentUser?.role ?? '')
  const canEditDiscount = isAdmin || !systemSettings.salesDiscountControl

  // Primary bank account for payment instructions (first active non-cash/mpesa)
  const primaryBank = bankAccounts.find(a => a.active && a.id !== 'cash' && a.id !== 'mpesa')

  const [showSerialModal, setShowSerialModal] = useState<{ orderId: string; lineId: string; productId: string; productName: string; needed: number } | null>(null)

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
  const [addLineProduct, setAddLineProduct] = useState<typeof products[0] | null>(null)
  const [sourceSelections, setSourceSelections] = useState<Record<string, 'shop' | 'warehouse'>>({})
  const [printMode, setPrintMode] = useState<'quote' | 'proforma' | 'delivery_note' | null>(null)

  // New contact modal state
  const [newContactQuery, setNewContactQuery] = useState('')
  const [newContactSelected, setNewContactSelected] = useState<Contact | null>(null)
  const [showCreateContact, setShowCreateContact] = useState(false)
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')

  const activeOrder = saleOrders.find(s => s.id === activeId) ?? null
  const delivery = activeOrder ? deliveries.find(d => d.saleOrderId === activeOrder.id) ?? null : null
  const linkedInvoice = activeOrder?.invoiceId ? invoices.find(i => i.id === activeOrder.invoiceId) ?? null : null
  const linkedCustomer = activeOrder ? contacts.find(c => c.id === activeOrder.customerId) ?? null : null

  const customers = useMemo(() => contacts.filter(c => c.isCustomer), [contacts])
  const sellableProducts = useMemo(() => products.filter(p => p.canBeSold && p.isActive), [products])

  const saved = !!activeOrder?.savedAt

  const filtered = useMemo(() => saleOrders.filter(s => {
    const mf = filter === 'all' || s.status === filter
    const ms = !search || s.ref.toLowerCase().includes(search.toLowerCase()) || s.customerName.toLowerCase().includes(search.toLowerCase())
    return mf && ms
  }), [saleOrders, filter, search])

  const stats = useMemo(() => ({
    quotations: saleOrders.filter(s => s.status === 'quotation').length,
    confirmed:  saleOrders.filter(s => s.status === 'confirmed').length,
    toInvoice:  saleOrders.filter(s => s.status === 'confirmed' || s.status === 'delivered').length,
    revenue:    saleOrders.filter(s => s.status === 'invoiced').reduce((a, s) => a + s.total, 0),
  }), [saleOrders])

  const openOrder = (id: string) => { setActiveId(id); setView('form') }
  const backToList = () => { setView('list'); setActiveId(null) }

  // ── New quotation modal helpers ──────────────────────────────────────────────
  const filteredCustomers = customers.filter(c =>
    !newContactQuery.trim() ||
    c.name.toLowerCase().includes(newContactQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(newContactQuery.toLowerCase())
  )
  const queryHasExactMatch = customers.some(c => c.name.toLowerCase() === newContactQuery.toLowerCase().trim())

  const handleCreateNewContact = async () => {
    if (!newContactQuery.trim()) { showToast('Enter a contact name', 'error'); return }
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
    setNewContactSelected(contact)
    setShowCreateContact(false)
  }

  const handleCreate = () => {
    if (!newContactSelected) { showToast('Please select or create a contact', 'error'); return }
    const creditStatus = getCustomerCreditStatus(newContactSelected.id)
    if (creditStatus.isLocked) { showToast(creditStatus.message, 'error'); return }
    const so = createSaleOrder(newContactSelected.id, newContactSelected.name)
    setShowNewModal(false)
    setNewContactQuery('')
    setNewContactSelected(null)
    setNewContactPhone('')
    setNewContactEmail('')
    setShowCreateContact(false)
    openOrder(so.id)
  }

  const closeNewModal = () => {
    setShowNewModal(false)
    setNewContactQuery('')
    setNewContactSelected(null)
    setNewContactPhone('')
    setNewContactEmail('')
    setShowCreateContact(false)
  }

  const handleAddLine = () => {
    if (!addLineProduct || !activeId) return
    const qty = Math.max(0, Number(addLineQty) || 0)
    const disc = Number(addLineDiscount) || 0
    // Only check stock when qty > 0
    if (qty > 0 && addLineProduct.unit !== 'service') {
      const locs = getStockByLocation(addLineProduct.id)
      const availableForSales = locs.shop + locs.warehouse
      if (availableForSales < qty) {
        showToast(`Only ${availableForSales} units available for sales stock out`, 'error'); return
      }
    }
    addSOLine(activeId, addLineProduct, qty, disc, addLineVat ? companySettings.vatRate : 0)
    setShowAddLine(false); setAddLineProduct(null); setAddLineQty(''); setAddLineDiscount('0'); setAddLineVat(false)
  }

  // Update a single line's unit price, discount, or taxRate, then recalculate
  const updateLine = (lineId: string, field: 'unitPrice' | 'discount' | 'taxRate' | 'qty', value: number) => {
    if (!activeOrder) return
    const lines = activeOrder.lines.map(l => {
      if (l.id !== lineId) return l
      const newUnitPrice = field === 'unitPrice' ? value : l.unitPrice
      const newDiscount  = field === 'discount'  ? value : l.discount
      const newTaxRate   = field === 'taxRate'   ? value : l.taxRate
      const newQty       = field === 'qty'        ? Math.max(0, value) : l.qty
      const subtotal = Math.round(newUnitPrice * newQty * (1 - newDiscount / 100))
      return { ...l, unitPrice: newUnitPrice, discount: newDiscount, taxRate: newTaxRate, qty: newQty, subtotal }
    })
    const sub = lines.reduce((a, l) => a + l.subtotal, 0)
    const tax = lines.reduce((a, l) => a + Math.round(l.subtotal * l.taxRate / 100), 0)
    updateSaleOrder(activeOrder.id, { lines, subtotal: sub, taxTotal: tax, total: sub + tax })
  }

  // ── Print / PDF view ────────────────────────────────────────────────────────
  if (printMode === 'delivery_note' && activeOrder && delivery) {
    const dnLines = delivery.lines.map(dl => {
      const soLine  = activeOrder.lines.find(l => l.productId === dl.productId)
      const product = products.find(p => p.id === dl.productId)
      const serialIds = dl.serialIds.length > 0 ? dl.serialIds : (soLine?.serialIds ?? [])
      const lineSerials: SerialNumber[] = serialIds
        .map(sid => serials.find(s => s.id === sid))
        .filter((s): s is SerialNumber => !!s)
      return { ...dl, soLine, product, lineSerials, requiresSerial: !!product?.requiresSerial }
    })
    const hasAnySerial = dnLines.some(l => l.requiresSerial)

    return (
      <div className="print-document-container" style={{ background: '#fff', color: '#111', minHeight: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <div className="no-print" style={{ background: '#f4f4f8', padding: '10px 24px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #ddd' }}>
          <button onClick={() => window.print()} style={{ background: CO.navy, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨️ Print / Save PDF</button>
          <button onClick={() => setPrintMode(null)} style={{ background: 'transparent', color: '#555', border: '1px solid #ccc', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>← Back</button>
        </div>

        <div style={{ maxWidth: 780, margin: '0 auto', padding: '36px 48px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {companySettings.logoUrl
                ? <img src={companySettings.logoUrl} alt={companySettings.name} style={{ height: 56, objectFit: 'contain', maxWidth: 180 }} />
                : <img src="/logo.png" alt={companySettings.name} style={{ height: 56, objectFit: 'contain' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              }
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: '#333', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{companySettings.name}</div>
              <div>{companySettings.address}</div>
              <div>{companySettings.phone}</div>
              <div>{companySettings.city}</div>
              <div style={{ color: CO.navy, fontWeight: 600 }}>PIN: {companySettings.kraPin}</div>
            </div>
          </div>

          <div style={{ background: CO.navy, color: '#fff', padding: '10px 16px', borderRadius: 4, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>DELIVERY NOTE</span>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{delivery.ref}</span>
          </div>

          <div style={{ display: 'flex', gap: 40, fontSize: 11, marginBottom: 24 }}>
            <div>
              <div style={{ fontWeight: 700, color: '#555', marginBottom: 2 }}>DATE</div>
              <div>{fmtDate(delivery.date)}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#555', marginBottom: 2 }}>SALE ORDER</div>
              <div style={{ fontFamily: 'monospace' }}>{activeOrder.ref}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#555', marginBottom: 2 }}>PREPARED BY</div>
              <div>{activeOrder.createdByName ?? companySettings.name}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
            <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.1em', marginBottom: 6 }}>DELIVERED TO</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{activeOrder.customerName}</div>
              {linkedCustomer?.address && <div style={{ fontSize: 11, color: '#444', marginTop: 3 }}>{linkedCustomer.address}</div>}
              {linkedCustomer?.city && <div style={{ fontSize: 11, color: '#444' }}>{linkedCustomer.city}{linkedCustomer.country ? `, ${linkedCustomer.country}` : ''}</div>}
              {linkedCustomer?.phone && <div style={{ fontSize: 11, color: '#444', marginTop: 3 }}>{linkedCustomer.phone}</div>}
              {linkedCustomer?.email && <div style={{ fontSize: 11, color: '#444' }}>{linkedCustomer.email}</div>}
              {linkedCustomer?.vatNumber && <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>PIN: {linkedCustomer.vatNumber}</div>}
            </div>
            <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.1em', marginBottom: 6 }}>DELIVERY LOCATION</div>
              {linkedCustomer?.address
                ? <>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{linkedCustomer.address}</div>
                    {linkedCustomer.city && <div style={{ fontSize: 11, color: '#444', marginTop: 3 }}>{linkedCustomer.city}</div>}
                  </>
                : <div style={{ fontSize: 11, color: '#999', fontStyle: 'italic' }}>As per customer address above</div>
              }
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '9px 10px', textAlign: 'left', fontWeight: 700, color: '#333', width: 30 }}>#</th>
                <th style={{ padding: '9px 10px', textAlign: 'left', fontWeight: 700, color: '#333' }}>DESCRIPTION</th>
                <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: '#333', width: 70 }}>QTY</th>
                {hasAnySerial && (
                  <th style={{ padding: '9px 10px', textAlign: 'left', fontWeight: 700, color: '#333', width: 220 }}>SERIAL NUMBER(S)</th>
                )}
                <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: '#333', width: 70 }}>RECEIVED</th>
              </tr>
            </thead>
            <tbody>
              {dnLines.map((dl, i) => (
                <tr key={dl.productId} style={{ borderBottom: '1px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafafa', verticalAlign: 'top' }}>
                  <td style={{ padding: '9px 10px', color: '#888' }}>{i + 1}</td>
                  <td style={{ padding: '9px 10px', fontWeight: 600 }}>{dl.productName}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700 }}>{dl.qty}</td>
                  {hasAnySerial && (
                    <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontSize: 10, color: '#333' }}>
                      {dl.requiresSerial
                        ? dl.lineSerials.length > 0
                          ? dl.lineSerials.map(s => (
                              <div key={s.id} style={{ marginBottom: 3, padding: '2px 6px', background: '#E8F3FA', border: '1px solid #A8D4E8', borderRadius: 3, display: 'inline-block', marginRight: 4, fontWeight: 600 }}>
                                {s.serial}
                              </div>
                            ))
                          : Array.from({ length: dl.qty }).map((_, i) => (
                              <div key={i} style={{ borderBottom: '1px solid #999', width: 160, marginBottom: 6, height: 16 }} />
                            ))
                        : <span style={{ color: '#bbb', fontSize: 10 }}>N/A</span>
                      }
                    </td>
                  )}
                  <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                    <div style={{ width: 18, height: 18, border: '1.5px solid #aaa', borderRadius: 3, margin: '0 auto' }} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #ddd', background: '#f5f5f5' }}>
                <td colSpan={2} style={{ padding: '8px 10px', fontWeight: 700, fontSize: 12 }}>TOTAL ITEMS</td>
                <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, fontSize: 13 }}>
                  {dnLines.reduce((s, l) => s + l.qty, 0)}
                </td>
                {hasAnySerial && <td />}
                <td />
              </tr>
            </tfoot>
          </table>

          {activeOrder.notes && (
            <div style={{ fontSize: 11, color: '#555', marginBottom: 20, padding: '8px 12px', background: '#f8f8f8', borderRadius: 4, border: '1px solid #eee' }}>
              <strong>Notes:</strong> {activeOrder.notes}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 36 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: '0.1em', marginBottom: 10 }}>ISSUED BY (DEED TECHNOLOGIES)</div>
              <div style={{ borderBottom: '1px solid #333', marginBottom: 6, height: 40 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555' }}>
                <span>Signature</span>
                <span style={{ borderBottom: '1px solid #aaa', width: 110 }} />
              </div>
              <div style={{ marginTop: 10, borderBottom: '1px solid #aaa', height: 22 }} />
              <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>Name &amp; Designation</div>
              <div style={{ marginTop: 10, borderBottom: '1px solid #aaa', height: 22 }} />
              <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>Date</div>
            </div>
            <div style={{ background: '#FAFAFA', border: '1.5px solid #E0E0E0', borderRadius: 6, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#444', letterSpacing: '0.1em', marginBottom: 10 }}>RECEIVED BY (CUSTOMER)</div>
              <div style={{ borderBottom: '1px solid #333', marginBottom: 6, height: 44 }} />
              <div style={{ fontSize: 10, color: '#555', marginBottom: 12 }}>Signature</div>
              <div style={{ borderBottom: '1px solid #aaa', height: 22 }} />
              <div style={{ fontSize: 10, color: '#555', marginTop: 4, marginBottom: 12 }}>Full Name</div>
              <div style={{ borderBottom: '1px solid #aaa', height: 22 }} />
              <div style={{ fontSize: 10, color: '#555', marginTop: 4, marginBottom: 12 }}>ID / Company Position</div>
              <div style={{ borderBottom: '1px solid #aaa', height: 22 }} />
              <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>Date Received</div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #ddd', paddingTop: 12, marginTop: 28, textAlign: 'center', fontSize: 10, color: '#999', lineHeight: 1.8 }}>
            <div>This delivery note confirms the goods described above have been dispatched from {companySettings.name}.</div>
            <div>Please retain this document as proof of delivery. Disputes must be raised within 48 hours of receipt.</div>
            <div style={{ marginTop: 4 }}>{companySettings.website} · {companySettings.email || companySettings.phone}</div>
          </div>
        </div>

        <style>{`
          @media print { 
            body * { visibility: hidden; } 
            .print-document-container, .print-document-container * { visibility: visible; } 
            .print-document-container { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; } 
            .no-print, .no-print * { display: none !important; } 
          }
        `}</style>
      </div>
    )
  }

  if (printMode && activeOrder) {
    const isQuote = printMode === 'quote'
    const docTitle = isQuote
      ? `Quotation # ${activeOrder.ref}`
      : `Proforma Invoice ${activeOrder.ref}`

    return (
      <div className="print-document-container" style={{ background: '#fff', color: '#111', minHeight: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <div className="no-print" style={{ background: '#f4f4f8', padding: '10px 24px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid #ddd' }}>
          <button onClick={() => window.print()} style={{ background: CO.navy, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨️ Print / Save PDF</button>
          <button onClick={() => setPrintMode(null)} style={{ background: 'transparent', color: '#555', border: '1px solid #ccc', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>← Back</button>
        </div>

        <div style={{ maxWidth: 780, margin: '0 auto', padding: '36px 48px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {companySettings.logoUrl
                ? <img src={companySettings.logoUrl} alt={companySettings.name} style={{ height: 56, objectFit: 'contain', maxWidth: 180 }} />
                : <img src="/logo.png" alt={companySettings.name} style={{ height: 56, objectFit: 'contain' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              }
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: '#333', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{companySettings.name}</div>
              <div>{companySettings.address}</div>
              <div>{companySettings.phone}</div>
              <div>{companySettings.city}</div>
              <div style={{ color: CO.navy, fontWeight: 600 }}>PIN: {companySettings.kraPin}</div>
            </div>
          </div>

          <div style={{ marginBottom: 20, fontSize: 12, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600 }}>{activeOrder.customerName}</div>
            {linkedCustomer?.address && <div>{linkedCustomer.address}</div>}
            {linkedCustomer?.city && <div>{linkedCustomer.city}</div>}
            {linkedCustomer?.country && <div>{linkedCustomer.country}</div>}
            {linkedCustomer?.vatNumber && <div>Tax ID: {linkedCustomer.vatNumber}</div>}
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: CO.navy, marginBottom: 12 }}>{docTitle}</div>

            <div style={{ display: 'flex', gap: 48, fontSize: 11 }}>
              <div>
                <div style={{ fontWeight: 700, color: '#333' }}>{isQuote ? 'Quotation Date:' : 'Invoice Date:'}</div>
                <div>{fmtDate(activeOrder.date)}</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, color: '#333' }}>Expiration:</div>
                <div>{activeOrder.validUntil ? fmtDate(activeOrder.validUntil) : '—'}</div>
              </div>
              {(activeOrder as any).salespersonName && (
                <div>
                  <div style={{ fontWeight: 700, color: '#333' }}>Salesperson:</div>
                  <div>{(activeOrder as any).salespersonName}</div>
                </div>
              )}
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '9px 10px', textAlign: 'left',   fontWeight: 700, color: '#333' }}>DESCRIPTION</th>
                <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: '#333', width: 80 }}>QUANTITY</th>
                <th style={{ padding: '9px 10px', textAlign: 'right',  fontWeight: 700, color: '#333', width: 100 }}>UNIT PRICE</th>
                <th style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: '#333', width: 120 }}>TAXES</th>
                <th style={{ padding: '9px 10px', textAlign: 'right',  fontWeight: 700, color: '#333', width: 110 }}>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {activeOrder.lines.map((l, i) => (
                <tr key={l.id} style={{ borderBottom: '1px solid #eee', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '8px 10px' }}>{l.productName}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{l.qty}.00 Units</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{l.unitPrice.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#555' }}>Sales VAT ({l.taxRate}%)</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{l.subtotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })} KSh</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 11, color: '#333', marginBottom: 20 }}>
            Please use the following communication for your payment : <strong>{activeOrder.ref}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 32, marginBottom: 28 }}>
            <div style={{ fontSize: 11, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>PAYMENT DETAILS</div>
              <div>Account Name: <strong>{companySettings.name.toUpperCase()}</strong></div>
              {primaryBank ? (
                <>
                  <div>Account number: {primaryBank.accountNo} (KES)</div>
                  <div>Bank: {primaryBank.bankName}</div>
                  <div>Account: {primaryBank.name}</div>
                </>
              ) : (
                <>
                  <div>Account number: {CO.bankAccount} (KES)</div>
                  <div>Bank: {CO.bankName}</div>
                  <div>Branch: {CO.bankBranch}</div>
                </>
              )}
              {(companySettings.mpesaPaybill || CO.mpesaPaybill) && (
                <>
                  <div style={{ marginTop: 8, fontWeight: 700 }}>MPESA</div>
                  <div>PAY BILL NO: {companySettings.mpesaPaybill || CO.mpesaPaybill}</div>
                  <div>Account number: {companySettings.mpesaAccount || CO.mpesaAccount} (KES)</div>
                </>
              )}
            </div>

            <div style={{ minWidth: 260, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid #ddd' }}>
                <span>Untaxed Amount</span>
                <span style={{ fontWeight: 600 }}>{activeOrder.subtotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })} KSh</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid #ddd' }}>
                <span>VAT {companySettings.vatRate}%</span>
                <span style={{ fontWeight: 600 }}>{activeOrder.taxTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })} KSh</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 12px', background: CO.navy, color: '#fff', fontWeight: 700, fontSize: 13, borderRadius: '0 0 4px 4px' }}>

                <span>Total</span>
                <span>{activeOrder.total.toLocaleString('en-KE', { minimumFractionDigits: 2 })} KSh</span>
              </div>
            </div>
          </div>

          {activeOrder.notes && (
            <div style={{ fontSize: 11, color: '#555', marginBottom: 16, padding: '8px 12px', background: '#f8f8f8', borderRadius: 4 }}>
              <strong>Notes:</strong> {activeOrder.notes}
            </div>
          )}

          <div style={{ borderTop: '1px solid #ddd', paddingTop: 12, textAlign: 'center', fontSize: 11, color: '#666', lineHeight: 1.8 }}>
            <div>{companySettings.invoiceFooter || 'Thank you for your business'}</div>
            <div>{companySettings.website}</div>
            <div style={{ marginTop: 4, fontSize: 10 }}>Page: 1 / 1</div>
          </div>
        </div>

        <style>{`
          @media print { 
            body * { visibility: hidden; } 
            .print-document-container, .print-document-container * { visibility: visible; } 
            .print-document-container { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; } 
            .no-print, .no-print * { display: none !important; } 
          }
        `}</style>
      </div>
    )
  }

  // ── Form view ──────────────────────────────────────────────────────────────
  if (view === 'form' && activeOrder) {
    const isQuotation = activeOrder.status === 'quotation'
    const isConfirmed = activeOrder.status === 'confirmed'
    const canEdit    = isQuotation
    const canDelete  = isQuotation && !saved
    const canInvoice = (activeOrder.status === 'confirmed' || activeOrder.status === 'delivered') && !activeOrder.invoiceId

    return (
      <div className="flex flex-col gap-3">
        {/* Header bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn-outline text-[11px] py-1 px-2.5" onClick={backToList}>← Orders</button>
          <span className="text-t3 text-xs">/</span>
          <span className="text-xs font-semibold">{activeOrder.ref}</span>
          <Badge status={activeOrder.status} />
          {!saved && isQuotation && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(247,144,9,0.12)', color: '#F79009', border: '0.5px solid rgba(247,144,9,0.3)' }}>
              ● Unsaved Draft
            </span>
          )}
        <div className="w-full sm:w-auto sm:ml-auto flex gap-2 flex-wrap mt-1 sm:mt-0">
            {/* Print / proforma — only after Save */}
            {saved && (
              <>
                <button className="btn-outline text-[11px]" onClick={() => setPrintMode('quote')}>📄 Quotation</button>
                <button className="btn-outline text-[11px]" onClick={() => setPrintMode('proforma')}>📋 Proforma</button>
              </>
            )}
            {delivery && (
              <button className="btn-outline text-[11px]" onClick={() => setPrintMode('delivery_note')}>📦 Delivery Note</button>
            )}

            {/* Quotation actions */}
            {isQuotation && !saved && (
              <button className="btn-primary" onClick={() => {
                if (activeOrder.lines.length === 0) { showToast('Add at least one product before saving', 'error'); return }
                updateSaleOrder(activeOrder.id, { savedAt: new Date().toISOString() })
                showToast(`${activeOrder.ref} saved`)
              }}>
                💾 Save Quotation
              </button>
            )}
            {isQuotation && saved && (() => {
              const zeroQtyLines = activeOrder.lines.filter(l => l.qty === 0)
              return (
              <button
                className="btn-primary"
                title={zeroQtyLines.length > 0 ? `${zeroQtyLines.length} line(s) have no quantity` : undefined}
                onClick={() => {
                if (zeroQtyLines.length > 0) { showToast(`Set quantity for: ${zeroQtyLines.map(l => l.productName).join(', ')}`, 'error'); return }
                const deliveryLines = activeOrder.lines.map(line => {
                  const locs = getStockByLocation(line.productId)
                  if (locs.shop > 0 && locs.warehouse > 0 && !sourceSelections[line.id]) return line.id
                  return null
                }).filter(Boolean)
                if (deliveryLines.length > 0) { showToast('Select a dispatch source for each delivery line', 'error'); return }
                const cs = getCustomerCreditStatus(activeOrder.customerId, activeOrder.total)
                if (!cs.ok) { showToast(cs.message, 'error'); return }
                confirmSO(activeOrder.id)
              }}>
                ✓ Confirm Order
              </button>
              )
            })()}

            {/* Confirmed order actions: 4 buttons */}
            {(isConfirmed || activeOrder.status === 'delivered') && (
              <>
                {delivery?.status === 'ready' && (
                  <button className="btn-primary" style={{ background: '#F79009' }} onClick={() => confirmDeliveryWithStockDeduction(delivery.id)}>
                    📦 Confirm Delivery (Stock Out)
                  </button>
                )}
                {canInvoice && (
                  <button className="btn-primary" style={{ background: '#12B76A' }} onClick={() => createInvoiceFromSO(activeOrder.id)}>
                    🧾 Convert to Invoice
                  </button>
                )}
                <button className="btn-outline text-[11px]" onClick={() => resetSOToDraft(activeOrder.id)}>
                  ↩ Reset to Draft
                </button>
                <button className="btn-outline text-[11px]" style={{ color: '#EF4444', borderColor: '#FCA5A5' }}
                  onClick={() => cancelSO(activeOrder.id)}>
                  ✕ Cancel
                </button>
              </>
            )}

            {canDelete && (
              <button className="btn-outline text-[11px]" style={{ color: '#EF4444', borderColor: '#FCA5A5' }}
                onClick={() => setShowDelConfirm(true)}>Delete</button>
            )}
          </div>
        </div>

        {/* Status stepper */}
        <div className="card p-4">
          <StatusStepper steps={SO_STEPS} current={activeOrder.status === 'cancelled' ? 'quotation' : activeOrder.status} />
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          {/* ── Left col ── */}
          <div className="flex flex-col gap-3 flex-1 min-w-0">
            {/* Details */}
            <div className="card overflow-hidden">
              <PanelHeader title="Order Details" />
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Customer">
                  <div className="form-input text-xs">{activeOrder.customerName}</div>
                </Field>
                <Field label="Order Date">
                  <div className="form-input text-xs">{fmtDate(activeOrder.date)}</div>
                </Field>
                <Field label="Valid Until">
                  {canEdit
                    ? <input className="form-input" type="date" value={activeOrder.validUntil}
                        onChange={e => updateSaleOrder(activeOrder.id, { validUntil: e.target.value })} />
                    : <div className="form-input text-xs">{activeOrder.validUntil ? fmtDate(activeOrder.validUntil) : '—'}</div>
                  }
                </Field>
                <Field label="Reference">
                  <div className="form-input text-xs font-mono">{activeOrder.ref}</div>
                </Field>
              </div>
            </div>

            {/* Order Lines */}
            <div className="card overflow-hidden">
              <PanelHeader title="Order Lines" count={activeOrder.lines.length}>
                {canEdit && <button className="btn-primary text-[11px] sm:text-xs w-full sm:w-auto justify-center mt-2 sm:mt-0" onClick={() => setShowAddLine(true)}>+ Add Product</button>}
              </PanelHeader>
              <div className="overflow-x-auto w-full">
              <div className="min-w-[800px] flex flex-col">
              {isQuotation && activeOrder.lines.some(l => l.qty === 0) && (
                <div style={{ background: '#FFFBEB', borderBottom: '1px solid #FDE68A', padding: '7px 14px', fontSize: 11, color: '#92400E', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⚠</span>
                  <span>Some lines have no quantity — set quantities before confirming the order.</span>
                </div>
              )}
              <div className="table-head" style={{ gridTemplateColumns: '1.8fr 90px 110px 100px 80px 95px 30px' }}>
                <span>Product</span><span>Qty</span><span>Unit Price</span><span>Discount %</span><span>Tax %</span><span>Subtotal</span><span></span>
              </div>
              {activeOrder.lines.length === 0
                ? <p className="px-4 py-8 text-xs text-t3 text-center">No products — click &ldquo;+ Add Product&rdquo; to begin</p>
                : activeOrder.lines.map(l => {
                    const prod = products.find(x => x.id === l.productId)
                    const assigned = l.serialIds?.length ?? 0
                    return (
                      <div key={l.id} className="table-row" style={{ gridTemplateColumns: '1.8fr 90px 110px 100px 80px 95px 30px', background: l.qty === 0 ? '#FFFBEB' : undefined }}>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{prod?.image ?? '📦'}</span>
                          <div>
                            <p className="font-medium">{l.productName}</p>
                            {prod?.unit !== 'service' && (() => {
                              const locs = getStockByLocation(l.productId)
                              const needsChoice = locs.shop > 0 && locs.warehouse > 0
                              return needsChoice ? (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-t3">Dispatch from</span>
                                  <select
                                    className="form-select text-[10px] py-1"
                                    value={sourceSelections[l.id] ?? ''}
                                    onChange={e => setSourceSelections(prev => ({ ...prev, [l.id]: e.target.value as 'shop' | 'warehouse' }))}
                                    style={{ width: 110 }}
                                  >
                                    <option value="">Select source</option>
                                    <option value="shop">With Issues</option>
                                    <option value="warehouse">Warehouse</option>
                                  </select>
                                </div>
                              ) : (
                                <p className="text-[10px] text-t3 mt-1">Dispatch source: {locs.shop > 0 ? 'With Issues' : 'Warehouse'}</p>
                              )
                            })()}
                            {prod?.requiresSerial ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px]" style={{ color: assigned >= l.qty ? '#10B981' : '#EF4444' }}>
                                  🔢 {assigned}/{l.qty} serials
                                </span>
                                {canEdit && assigned < l.qty && (
                                  <button style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: '#1B2762', fontSize: 9, borderRadius: 4, padding: '1px 5px' }}
                                    onClick={() => setShowSerialModal({ orderId: activeOrder.id, lineId: l.id, productId: l.productId, productName: l.productName, needed: l.qty })}>
                                    Assign
                                  </button>
                                )}
                              </div>
                            ) : prod && prod.unit !== 'service' && <p className="text-[10px] text-t3">{prod.stockQty} available in inventory</p>}
                          </div>
                        </div>
                        {/* Editable qty */}
                        {canEdit ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <button
                                style={{ width: 20, height: 20, lineHeight: 1, fontSize: 14, border: '1px solid #ddd', borderRadius: 4, background: '#f5f5f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => updateLine(l.id, 'qty', l.qty - 1)}
                                disabled={l.qty <= 0}
                              >−</button>
                              <input
                                type="number"
                                className="form-input text-xs font-mono text-center"
                                style={{ width: 32, padding: '2px 2px', borderColor: l.qty === 0 ? '#F59E0B' : undefined }}
                                value={l.qty}
                                min={0}
                                onChange={e => updateLine(l.id, 'qty', Number(e.target.value))}
                              />
                              <button
                                style={{ width: 20, height: 20, lineHeight: 1, fontSize: 14, border: '1px solid #ddd', borderRadius: 4, background: '#f5f5f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={() => updateLine(l.id, 'qty', l.qty + 1)}
                              >+</button>
                            </div>
                            {l.qty === 0 && (
                              <span style={{ fontSize: 9, color: '#D97706', fontWeight: 600 }}>qty needed</span>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono">{l.qty}</span>
                        )}
                        {/* Editable unit price */}
                        <div>
                          {canEdit ? (
                            <input
                              type="number"
                              className="form-input text-xs font-mono"
                              style={{ width: 90, padding: '3px 6px' }}
                              value={l.unitPrice}
                              min={0}
                              onChange={e => updateLine(l.id, 'unitPrice', Number(e.target.value) || 0)}
                            />
                          ) : (
                            <span className="font-mono">{fmtKes(l.unitPrice)}</span>
                          )}
                        </div>
                        {/* Editable discount */}
                        <div>
                          {canEdit && canEditDiscount ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                className="form-input text-xs font-mono"
                                style={{ width: 58, padding: '3px 6px' }}
                                value={l.discount}
                                min={0}
                                max={100}
                                onChange={e => updateLine(l.id, 'discount', Math.min(100, Number(e.target.value) || 0))}
                              />
                              <span className="text-[11px] text-t3">%</span>
                            </div>
                          ) : (
                            <span className="font-mono text-t3">{l.discount}%</span>
                          )}
                        </div>
                        {/* Editable tax rate */}
                        <div>
                          {canEdit ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                className="form-input text-xs font-mono"
                                style={{ width: 50, padding: '3px 6px' }}
                                value={l.taxRate}
                                min={0}
                                max={100}
                                placeholder="0"
                                onChange={e => updateLine(l.id, 'taxRate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                              />
                              <span className="text-[11px] text-t3">%</span>
                            </div>
                          ) : (
                            <span className="font-mono text-t3">{l.taxRate > 0 ? `${l.taxRate}%` : '—'}</span>
                          )}
                        </div>
                        <span className="font-mono font-semibold">{fmtKes(l.subtotal)}</span>
                        {canEdit && (
                          <button onClick={() => removeSOLine(activeOrder.id, l.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F04438', fontSize: 18, lineHeight: 1 }}>×</button>
                        )}
                      </div>
                    )
                  })
              }
              {activeOrder.lines.length > 0 && (
                <div className="flex justify-end p-4 border-t" style={{ borderColor: 'var(--border-lt)' }}>
                  <div className="flex flex-col gap-1.5 w-full sm:w-auto sm:min-w-[220px]">
                    <div className="flex justify-between text-xs"><span className="text-t3">Subtotal (excl. tax)</span><span className="font-mono">{fmtKes(activeOrder.subtotal)}</span></div>
                    {activeOrder.taxTotal > 0 && (
                      <div className="flex justify-between text-xs"><span className="text-t3">Tax</span><span className="font-mono">{fmtKes(activeOrder.taxTotal)}</span></div>
                    )}
                    <div className="flex justify-between text-sm font-bold pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <span>Total</span><span className="font-mono" style={{ color: '#1B2762' }}>{fmtKes(activeOrder.total)}</span>
                    </div>
                  </div>
                </div>
              )}
              </div>
              </div>
            </div>

            {/* Notes */}
            <div className="card overflow-hidden">
              <PanelHeader title="Notes & Terms" />
              <div className="p-4">
                <textarea className="form-input w-full text-xs" rows={3} placeholder="Internal notes or terms..."
                  value={activeOrder.notes}
                  onChange={e => updateSaleOrder(activeOrder.id, { notes: e.target.value })}
                  style={{ resize: 'vertical' }} />
              </div>
            </div>
          </div>

          {/* ── Right col ── */}
          <div className="flex flex-col gap-3 w-full lg:w-[300px] flex-shrink-0">
            {/* Customer info */}
            <div className="card overflow-hidden">
              <PanelHeader title="Customer" />
              <div className="p-4 flex flex-col gap-2">
                {linkedCustomer ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0"
                        style={{ background: '#E8F3FA', color: '#1B2762' }}>
                        {linkedCustomer.name[0]}
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{linkedCustomer.name}</p>
                        <p className="text-[10px] text-t3 capitalize">{linkedCustomer.type}</p>
                      </div>
                    </div>
                    {linkedCustomer.email && <p className="text-[11px] text-t2">{linkedCustomer.email}</p>}
                    {linkedCustomer.phone && <p className="text-[11px] text-t2">{linkedCustomer.phone}</p>}
                    {linkedCustomer.vatNumber && <p className="text-[10px] text-t3">PIN: {linkedCustomer.vatNumber}</p>}
                  </>
                ) : <p className="text-xs text-t3">{activeOrder.customerName}</p>}
              </div>
            </div>

            {/* Delivery status */}
            <div className="card overflow-hidden">
              <PanelHeader title="Delivery">
                <span className="badge badge-gray text-[9px]">{delivery ? '1' : '0'}</span>
              </PanelHeader>
              <div className="p-3">
                {delivery ? (
                  <div className="p-2.5 rounded-lg text-xs flex items-start justify-between gap-2"
                    style={{ background: 'rgba(247,144,9,0.08)', border: '0.5px solid rgba(247,144,9,0.2)' }}>
                    <div>
                      <p className="font-semibold font-mono">{delivery.ref}</p>
                      <p className="text-[10px] text-t3 mt-0.5">{delivery.lines.length} product(s) · {fmtDate(delivery.date)}</p>
                      {delivery.warrantyCreated && <p className="text-[10px] mt-1" style={{ color: '#10B981' }}>🛡️ Warranties created</p>}
                    </div>
                    <Badge status={delivery.status} />
                  </div>
                ) : (
                  <p className="text-xs text-t3 text-center py-3">
                    {activeOrder.status === 'quotation' ? 'Confirm order to create delivery' : 'No delivery yet'}
                  </p>
                )}
              </div>
            </div>

            {/* Invoice status */}
            <div className="card overflow-hidden">
              <PanelHeader title="Invoice">
                <span className="badge badge-gray text-[9px]">{linkedInvoice ? '1' : '0'}</span>
              </PanelHeader>
              <div className="p-3">
                {linkedInvoice ? (
                  <div className="p-2.5 rounded-lg text-xs flex items-start justify-between gap-2"
                    style={{ background: 'rgba(18,183,106,0.08)', border: '0.5px solid rgba(18,183,106,0.2)' }}>
                    <div>
                      <p className="font-semibold font-mono">{linkedInvoice.ref}</p>
                      <p className="text-[10px] text-t3 mt-0.5">{fmtKes(linkedInvoice.total)}</p>
                    </div>
                    <Badge status={linkedInvoice.status} />
                  </div>
                ) : (
                  <p className="text-xs text-t3 text-center py-3">
                    {canInvoice ? 'Ready to invoice' : 'No invoice yet'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Add product modal */}
        {showAddLine && (
          <Modal title="Add Product to Order" onClose={() => { setShowAddLine(false); setAddLineProduct(null); setAddLineVat(false) }}>
            <SearchPicker
              label="Product *"
              placeholder="Search by name, SKU or barcode..."
              items={sellableProducts}
              onSelect={p => setAddLineProduct(p)}
              renderItem={p => (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{p.image}</span>
                    <div>
                      <p className="font-medium text-xs">{p.name}</p>
                       <p className="text-[10px] text-t3">{p.sku} · {p.unit === 'service' ? 'Service' : `${getStockByLocation(p.id).shop + getStockByLocation(p.id).warehouse} available for sales`}</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs flex-shrink-0" style={{ color: '#10B981' }}>{fmtKes(p.salePrice)}</span>
                </div>
              )}
            />
            {addLineProduct && (
              <>
                <div className="p-3 rounded-lg text-xs" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                  <p className="font-semibold">{addLineProduct.name}</p>
                   <p className="text-t3 mt-1">Price: {fmtKes(addLineProduct.salePrice)} · Tax: {addLineProduct.taxRate}% · Warranty: {addLineProduct.warrantyMonths}mo · Stock: {addLineProduct.unit === 'service' ? '∞' : `${getStockByLocation(addLineProduct.id).shop} with issues / ${getStockByLocation(addLineProduct.id).warehouse} warehouse`}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Quantity">
                    <Input value={addLineQty} onChange={setAddLineQty} type="number" placeholder="0 — fill in later" />
                  </Field>
                  {canEditDiscount && (
                    <Field label="Discount %">
                      <Input value={addLineDiscount} onChange={setAddLineDiscount} type="number" placeholder="0" />
                    </Field>
                  )}
                </div>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:'var(--text-2)', userSelect:'none' }}>
                  <input type="checkbox" checked={addLineVat} onChange={e => setAddLineVat(e.target.checked)} />
                  Apply VAT ({companySettings.vatRate}%)
                </label>
                <p className="text-xs text-t2 text-right">
                  Line total: <span className="font-mono font-semibold">
                    {fmtKes(addLineProduct.salePrice * (Number(addLineQty) || 1) * (1 - (Number(addLineDiscount) || 0) / 100))}
                  </span>
                </p>
              </>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-outline" onClick={() => { setShowAddLine(false); setAddLineProduct(null); setAddLineVat(false) }}>Cancel</button>
              <button className="btn-primary" onClick={handleAddLine} disabled={!addLineProduct}>Add to Order</button>
            </div>
          </Modal>
        )}

        {showDelConfirm && (
          <Confirm
            message={`Delete ${activeOrder.ref}?`}
            detail="This action cannot be undone."
            onConfirm={() => { deleteSaleOrder(activeOrder.id); setShowDelConfirm(false); backToList() }}
            onCancel={() => setShowDelConfirm(false)}
          />
        )}

        {/* Serial assignment modal */}
        {showSerialModal && (
          <Modal title={`Assign Serials — ${showSerialModal.productName}`}
            subtitle={`Select ${showSerialModal.needed} unit(s)`}
            width={500} onClose={() => setShowSerialModal(null)}>
            {(() => {
              const availSerials = serials.filter(s => s.productId === showSerialModal.productId && s.status === 'available' && (s.location === 'shop' || s.location === 'warehouse'))
              const line = activeOrder.lines.find(l => l.id === showSerialModal.lineId)
              const alreadyAssigned = line?.serialIds ?? []
              return (
                <>
                  <div className="p-3 rounded-lg text-xs" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                    {alreadyAssigned.length}/{showSerialModal.needed} serials assigned ·
                    <span style={{ color: '#10B981' }}> {availSerials.length} available in inventory</span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                    {availSerials.length === 0 ? (
                      <p className="text-xs text-t3 text-center py-6">No available units in inventory — receive through purchase first</p>
                    ) : availSerials.map(s => {
                      const isAssigned = alreadyAssigned.includes(s.id)
                      return (
                        <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all"
                          style={{ background: isAssigned ? '#E8F3FA' : 'var(--bg-surface)', border: isAssigned ? '1px solid #A8D4E8' : '1px solid var(--border-lt)' }}
                          onClick={() => {
                            if (!isAssigned) assignSerialToSOLine(showSerialModal.orderId, showSerialModal.lineId, s.id)
                          }}>
                          <div>
                            <span className="font-mono font-semibold" style={{ color: isAssigned ? '#1B2762' : 'var(--text-1)' }}>{s.serial}</span>
                            <span className="text-[10px] text-t3 ml-2">{LOCATIONS[s.location]?.icon} {LOCATIONS[s.location]?.name}</span>
                          </div>
                          {isAssigned ? <span style={{ color: '#10B981', fontSize: 12 }}>✓ Assigned</span> : <span className="text-t3 text-[10px]">Click to assign</span>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button className="btn-outline" onClick={() => setShowSerialModal(null)}>Done</button>
                  </div>
                </>
              )
            })()}
          </Modal>
        )}
      </div>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* Mode switcher */}
      <div className="flex gap-2 items-center overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {([
          { id: 'dashboard', label: '📊 Dashboard' },
          { id: 'list',      label: '📋 Quotes & Orders' },
          { id: 'crm',         label: '🎯 CRM & Pipeline' },
          { id: 'reps',      label: '🏆 Rep Performance' },
          { id: 'after_sales', label: '🛡️ After-Sales & RMA' },
        ] as const).map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-[11px] sm:text-xs transition-all border ${
              mode === m.id 
                ? 'bg-blue-50 border-blue-200 text-blue-900 font-bold shadow-sm' 
                : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 font-medium'
            }`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Dashboard view */}
      {mode === 'dashboard' && <SalesDashboard />}

      {mode === 'reps' && <RepPerformance />}

      {mode === 'crm' && <CRM />}

      {mode === 'after_sales' && <AfterSales />}

      {mode === 'list' && <>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 kpi-grid">
          <StatCard label="Quotations"  value={stats.quotations} sub="awaiting confirmation" color="#F59E0B" icon={<Fa icon={faClipboardCheck} />} onClick={() => setFilter('quotation')} />
          <StatCard label="Confirmed"   value={stats.confirmed}  sub="order processing"      color="#3B82F6" icon={<Fa icon={faCircleCheck} />} onClick={() => setFilter('confirmed')} />
          <StatCard label="To Invoice"  value={stats.toInvoice}  sub="ready to bill"         color="#8B5CF6" icon={<Fa icon={faFileInvoiceDollar} />} onClick={() => setFilter('delivered')} />
          <StatCard label="Revenue"     value={fmtKes(stats.revenue)} sub="from invoiced orders" color="#10B981" icon={<Fa icon={faMoneyBillWave} />} />
        </div>

        <div className="card overflow-hidden">
          <PanelHeader title="Quotes & Orders" count={filtered.length}>
            <input className="form-input text-[11px] sm:text-xs py-1.5 w-full sm:w-48"
              placeholder="Search ref or customer..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn-primary text-[11px] sm:text-xs py-1.5 w-full sm:w-auto justify-center mt-2 sm:mt-0" onClick={() => setShowNewModal(true)}>+ New Quote</button>
          </PanelHeader>

          {/* Filter tabs */}
          <div className="flex gap-2 px-4 py-2.5 border-b overflow-x-auto scrollbar-hide" style={{ borderColor: 'var(--border-lt)' }}>
            {(['all', 'quotation', 'confirmed', 'delivered', 'invoiced', 'cancelled'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex-shrink-0 px-3.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] capitalize cursor-pointer transition-all border ${
                  filter === f 
                    ? 'bg-blue-50 border-blue-200 text-blue-900 font-bold shadow-sm' 
                    : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 font-medium'
                }`}>
                {f === 'all' ? 'All' : f === 'quotation' ? 'Quotes' : f}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto w-full">
            <div className="min-w-[650px] flex flex-col">
              <div className="table-scroll table-head" style={{ gridTemplateColumns: '100px 1.5fr 100px 1fr 90px 70px' }}>
                <span>Ref</span><span>Customer</span><span>Date</span><span>Total</span><span>Status</span><span>Open</span>
              </div>
              {filtered.length === 0
                ? <p className="py-10 text-center text-xs text-t3">No records found</p>
                : filtered.map(so => (
                  <div key={so.id} className="table-row" style={{ gridTemplateColumns: '100px 1.5fr 100px 1fr 90px 70px' }}
                    onClick={() => openOrder(so.id)}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{so.ref}</span>
                    <div>
                      <span className="font-medium">{so.customerName}</span>
                      {so.status === 'quotation' && !so.savedAt && (
                        <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(247,144,9,0.12)', color: '#F79009' }}>Draft</span>
                      )}
                    </div>
                    <span className="text-[11px] text-t3">{fmtDate(so.date)}</span>
                    <span className="font-mono text-[11px] font-semibold">{fmtKes(so.total)}</span>
                    <Badge status={so.status} />
                    <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); openOrder(so.id) }}>Open</button>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      </>}

      {/* New quotation modal */}
      {showNewModal && (
        <Modal title="New Quote" subtitle="Find or create a contact" onClose={closeNewModal} width={460}>
          {!showCreateContact ? (
            <>
              {/* Search existing contacts */}
              <div>
                <label className="form-label">Contact *</label>
                <input
                  className="form-input w-full"
                  placeholder="Type a name or email..."
                  value={newContactQuery}
                  onChange={e => { setNewContactQuery(e.target.value); setNewContactSelected(null) }}
                  autoFocus
                />
              </div>

              {/* Results list */}
              {newContactQuery.trim() && (
                <div className="flex flex-col gap-1 max-h-52 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border-lt)' }}>
                  {filteredCustomers.length === 0 && (
                    <p className="px-3 py-2 text-xs text-t3">No existing contacts match</p>
                  )}
                  {filteredCustomers.slice(0, 8).map(c => (
                    <div key={c.id}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-all text-xs"
                      style={{
                        background: newContactSelected?.id === c.id ? '#E8F3FA' : 'transparent',
                        borderBottom: '1px solid var(--border-lt)',
                      }}
                      onClick={() => setNewContactSelected(c)}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: '#DBEAFE', color: '#1E40AF' }}>
                        {c.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{c.name}</p>
                        <p className="text-[10px] text-t3 truncate">{c.email || c.phone}</p>
                      </div>
                      {newContactSelected?.id === c.id && <span style={{ color: '#10B981', fontSize: 13 }}>✓</span>}
                    </div>
                  ))}

                  {/* Create new option — shown when no exact match */}
                  {!queryHasExactMatch && newContactQuery.trim().length > 1 && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs"
                      style={{ background: 'rgba(0,176,215,0.07)', borderTop: '0.5px solid rgba(0,176,215,0.2)' }}
                      onClick={() => setShowCreateContact(true)}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0"
                        style={{ background: 'rgba(0,176,215,0.15)', color: '#00B0D7' }}>+</div>
                      <div>
                        <p className="font-semibold" style={{ color: '#00B0D7' }}>Create &ldquo;{newContactQuery.trim()}&rdquo;</p>
                        <p className="text-[10px] text-t3">Add as new contact</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {newContactSelected && (
                <div className="p-2.5 rounded-lg text-xs" style={{ background: '#E8F3FA', border: '1px solid #A8D4E8' }}>
                  ✓ <strong>{newContactSelected.name}</strong> selected
                  {newContactSelected.email && <span className="text-t3"> · {newContactSelected.email}</span>}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button className="btn-outline" onClick={closeNewModal}>Cancel</button>
                <button className="btn-primary" onClick={handleCreate} disabled={!newContactSelected}>
                  Create Quotation →
                </button>
              </div>
            </>
          ) : (
            /* Mini create-contact form */
            <>
              <div className="p-3 rounded-lg text-xs mb-2" style={{ background: 'rgba(0,176,215,0.07)', border: '0.5px solid rgba(0,176,215,0.2)' }}>
                <p className="font-semibold" style={{ color: '#00B0D7' }}>New contact: {newContactQuery.trim()}</p>
                <p className="text-t3 mt-0.5">Fill in details below. Only name is required.</p>
              </div>
              <Field label="Phone">
                <Input value={newContactPhone} type="tel" onChange={setNewContactPhone} placeholder="+254..." maxLength={20} pattern="^\+?[0-9\s\-\(\)]+$" />
              </Field>
              <Field label="Email">
                <Input value={newContactEmail} onChange={setNewContactEmail} placeholder="email@example.com" type="email" maxLength={100} />
              </Field>
              <div className="flex gap-2 justify-end">
                <button className="btn-outline" onClick={() => setShowCreateContact(false)}>← Back</button>
                <button className="btn-primary" onClick={handleCreateNewContact}>
                  Create &amp; Select →
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
