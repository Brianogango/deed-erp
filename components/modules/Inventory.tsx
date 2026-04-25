'use client'
import React, { useMemo, useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  useApp, Product, LOCATIONS, LocationId, CATEGORY_CONFIG, ALL_CATEGORIES, CategoryId,
  fmtKes, fmtDate, Account,
} from '@/lib/store'
import { Badge, Modal, Field, Input, Select, Confirm, StatCard, PanelHeader, SearchPicker, ModuleSkeleton } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faBoxesStacked, faArrowDown, faBarcode, faTriangleExclamation, faWarehouse, faWrench } from '@fortawesome/free-solid-svg-icons'

type MainTab = 'warehouse_view' | 'product_master' | 'opening_stock' | 'stock_in' | 'stock_out' | 'transfers' | 'reports'
type ReportTab = 'stock_on_hand' | 'opening_closing' | 'movements' | 'serial_tracking' | 'low_stock'

type ProductImportRow = {
  name: string; sku: string; category: string; barcode: string
  salePrice: number; costPrice: number; taxRate: number
  minStock: number; warrantyMonths: number; description: string
  status: 'new' | 'exists'
}

const INTERNAL_LOCS = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).map(k => ({
  value: k,
  label: `${LOCATIONS[k].icon} ${LOCATIONS[k].name}`,
}))

const blankProduct = () => ({
  name: '', sku: '', barcode: '', category: 'Laptops' as CategoryId,
  salePrice: '', costPrice: '', taxRate: '16', minStock: '5',
  description: '', canBeSold: true, canBePurchased: true, image: '📦',
  isActive: true, warrantyMonths: '12', saleAccountCode: '', costAccountCode: '',
})

const MONTH_OPTS = [
  { value: '01', label: 'Jan' }, { value: '02', label: 'Feb' }, { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' }, { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' }, { value: '08', label: 'Aug' }, { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
]

function readXlsx(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json<any>(ws))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function col(row: any, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim()) return String(row[k]).trim()
  }
  return ''
}

const ITEMS_PER_PAGE = 20

function Pagination({ total, page, setPage }: { total: number, page: number, setPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: '#F3F4F6', background: '#FAFAFA' }}>
      <span className="text-xs text-t3">Showing {(page - 1) * ITEMS_PER_PAGE + 1} to {Math.min(page * ITEMS_PER_PAGE, total)} of {total}</span>
      <div className="flex gap-2">
        <button className="btn-outline text-[10px] py-1 px-3" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</button>
        <button className="btn-outline text-[10px] py-1 px-3" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  )
}

export default function Inventory() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!mounted) {
    return (
      <ModuleSkeleton />
    )
  }

  const {
    products, addProduct, updateProduct,
    serials, stockMoves, stockTransfers,
    createTransfer, addTransferLine, validateTransfer, submitTransfer,
    importOpeningStock, openingStockPosted,
    getStockByLocation, getMonthlyMovements,
    purchaseOrders, receipts,
    showToast, currentUserId, users, accounts,
    refurbishmentJobs, createRefurbishmentJob, transferToSell,
    systemSettings,
        bulkStock,
  } = useApp()

  const [tab, setTab] = useState<MainTab>('warehouse_view')
  const [reportTab, setReportTab] = useState<ReportTab>('stock_on_hand')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(5, 7))
  const [reportProductId, setReportProductId] = useState('All')

  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [tab, search, catFilter, reportTab, reportMonth, reportProductId])

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<any>(blankProduct())

  const [showOpening, setShowOpening] = useState(false)
  const [openingLines, setOpeningLines] = useState<{ productId: string; productName: string; qty: string; serials: string; location: LocationId }[]>([])

  const [showTransfer, setShowTransfer] = useState(false)
  const [tFrom, setTFrom] = useState<LocationId>('warehouse')
  const [tTo, setTTo] = useState<LocationId>('shop')
  const [tNotes, setTNotes] = useState('')
  const [tProd, setTProd] = useState<Product | null>(null)
  const [tQty, setTQty] = useState('1')
  const [tSerials, setTSerials] = useState<string[]>([])
  const [tScanInput, setTScanInput] = useState('')

  // Product bulk import
  const productImportRef = useRef<HTMLInputElement>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importRows, setImportRows] = useState<ProductImportRow[]>([])

  // Opening stock Excel upload
  const openingImportRef = useRef<HTMLInputElement>(null)
  const [openingImportErrors, setOpeningImportErrors] = useState<string[]>([])

  // Refurbishment send-to state
  const [showNewRefurb, setShowNewRefurb] = useState(false)
  const [refurbSerial, setRefurbSerial] = useState<{ id: string; serial: string; productName: string } | null>(null)
  const [refurbIssueDesc, setRefurbIssueDesc] = useState('')

  const setF = (key: string) => (value: any) => setForm((prev: any) => ({ ...prev, [key]: value }))

  const stockableProducts = useMemo(
    () => products.filter(p => CATEGORY_CONFIG[p.category]?.trackStock && p.isActive),
    [products],
  )

  const filteredProducts = useMemo(
    () => products.filter(p => {
      const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
      const matchesCategory = catFilter === 'All' || p.category === catFilter
      return p.isActive && matchesSearch && matchesCategory
    }),
    [products, search, catFilter],
  )

  const { pendingReceipts, validatedReceipts } = useMemo(() => {
    const pending: typeof receipts = []
    const validated: typeof receipts = []
    for (const r of receipts) {
      if (r.status === 'draft') pending.push(r)
      else if (r.status === 'validated') validated.push(r)
    }
    return { pendingReceipts: pending, validatedReceipts: validated }
  }, [receipts])

  const stockOutMoves = useMemo(() => {
    const out: typeof stockMoves = []
    for (const m of stockMoves) {
      if (m.type === 'out' || m.type === 'return') out.push(m)
    }
    return out
  }, [stockMoves])

  const {
    lowStockProducts,
    reportFilteredProducts,
    filteredReportMoves,
    filteredTrackedSerials,
    filteredLowStock,
  } = useMemo(() => {
    const low: typeof stockableProducts = []
    const rProds: typeof stockableProducts = []
    const lStock: typeof stockableProducts = []
    const validProductIds = new Set<string>()

    for (const p of stockableProducts) {
      const isLow = p.stockQty <= p.minStock && p.minStock > 0
      if (isLow) low.push(p)

      const matchesCat = catFilter === 'All' || p.category === catFilter
      const matchesId = reportProductId === 'All' || p.id === reportProductId
      if (matchesCat && matchesId) {
        validProductIds.add(p.id)
        rProds.push(p)
        if (isLow) lStock.push(p)
      }
    }

    const rMoves: typeof stockMoves = []
    for (const m of stockMoves) {
      if (m.date.slice(5, 7) === reportMonth && validProductIds.has(m.productId)) {
        rMoves.push(m)
      }
    }

    const rSerials: typeof serials = []
    for (const s of serials) {
      if (['available', 'sold', 'under_repair', 'returned'].includes(s.status) && validProductIds.has(s.productId)) {
        rSerials.push(s)
      }
    }

    return {
      lowStockProducts: low,
      reportFilteredProducts: rProds,
      filteredReportMoves: rMoves,
      filteredTrackedSerials: rSerials,
      filteredLowStock: lStock,
    }
  }, [stockableProducts, stockMoves, serials, catFilter, reportProductId, reportMonth])

  const kpis = useMemo(() => {
    let activeProducts = 0
    for (const p of products) {
      if (p.isActive) activeProducts++
    }
    let availSerials = 0
    for (const s of serials) {
      if (s.status === 'available') availSerials++
    }
    return {
      productMasters: activeProducts,
      stockReceipts: validatedReceipts.length,
      serialTracked: availSerials,
      lowStock: lowStockProducts.length,
    }
  }, [products, validatedReceipts.length, serials, lowStockProducts.length])

  const reportStats = useMemo(() => {
    const map = new Map<string, {
      locs: Record<string, number>;
      monthly: { opening: number; purchases: number; sales: number; usage: number; closing: number }
    }>()

    for (const p of reportFilteredProducts) {
      map.set(p.id, {
        locs: { warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0 },
        monthly: { opening: 0, purchases: 0, sales: 0, usage: 0, closing: 0 }
      })
    }

    for (const s of serials) {
      const st = map.get(s.productId)
      if (st && s.status !== 'returned') {
        st.locs[s.location] = (st.locs[s.location] || 0) + 1
      }
    }

    for (const b of bulkStock) {
      const st = map.get(b.productId)
      if (st) {
        st.locs[b.location] = b.qty
      }
    }

    for (const m of stockMoves) {
      const st = map.get(m.productId)
      if (st) {
        if (m.type === 'in') st.monthly.purchases += m.qty
        else if (m.type === 'out') st.monthly.sales += m.qty
        else if (m.type === 'transfer') st.monthly.usage += m.qty
      }
    }

    for (const st of Array.from(map.values())) {
      st.monthly.closing = st.monthly.opening + st.monthly.purchases - st.monthly.sales - st.monthly.usage
    }

    return map
  }, [reportFilteredProducts, serials, bulkStock, stockMoves])

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const canTransfer = !!currentUser && ['admin', 'lead_tech'].includes(currentUser.role)
  const canEditStock = canTransfer || !systemSettings.invNoDirectStockEdits

  const locationOpts = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).map((k, i) => ({
    value: k,
    label: systemSettings.invStorageLocations[i] ? `${LOCATIONS[k].icon} ${systemSettings.invStorageLocations[i]}` : `${LOCATIONS[k].icon} ${LOCATIONS[k].name}`,
  }))
  const activeRefurbSerialIds = useMemo(() => {
    const ids = new Set<string>()
    for (const j of refurbishmentJobs) {
      if (j.status !== 'transferred' && j.status !== 'written_off') {
        ids.add(j.serialId)
      }
    }
    return ids
  }, [refurbishmentJobs])

  const openNew = () => { setForm(blankProduct()); setEditId(null); setShowForm(true) }

  const openEdit = (product: Product) => {
    setForm({
      ...product,
      salePrice: String(product.salePrice), costPrice: String(product.costPrice),
      minStock: String(product.minStock), taxRate: String(product.taxRate),
      warrantyMonths: String(product.warrantyMonths),
      saleAccountCode: product.saleAccountCode ?? '', costAccountCode: product.costAccountCode ?? '',
    })
    setEditId(product.id)
    setShowForm(true)
  }

  const saveProduct = () => {
    if (!form.name.trim() || !form.sku.trim()) { showToast('Product name and SKU are required', 'error'); return }
    const cfg = CATEGORY_CONFIG[form.category as CategoryId]
    const payload = {
      ...form,
      salePrice: Number(form.salePrice) || 0, costPrice: Number(form.costPrice) || 0,
      stockQty: 0, minStock: Number(form.minStock) || 0, taxRate: Number(form.taxRate) || 0,
      warrantyMonths: Number(form.warrantyMonths) || 0,
      requiresSerial: cfg?.serialRequired ?? false, unit: cfg?.trackStock ? 'pcs' : 'service',
    }
    editId ? updateProduct(editId, payload) : addProduct(payload)
    setShowForm(false)
  }

  // ── Product import template download ──
  const downloadProductTemplate = () => {
    const headers = ['Name', 'SKU', 'Category', 'Barcode', 'Sale Price', 'Cost Price', 'Tax Rate', 'Min Stock', 'Warranty Months', 'Description']
    const categories = ALL_CATEGORIES.join(' | ')
    const sampleRows = [
      ['HP ProBook 450 G9', 'HP-PB450G9-001', 'Laptops', '1234567890123', 85000, 72000, 16, 3, 12, 'Intel Core i5, 8GB RAM, 256GB SSD'],
      ['Dell OptiPlex 3000', 'DELL-OPX3000-001', 'Desktops', '9876543210987', 75000, 63000, 16, 2, 12, 'Intel Core i3, 4GB RAM, 1TB HDD'],
      ['Cat6 Ethernet Cable 5m', 'NET-CAT6-5M', 'Networking', '', 850, 500, 16, 10, 0, 'Shielded Cat6 patch cable'],
      ['HP LaserJet Toner CF217A', 'HP-TON-CF217A', 'Parts & Components', '', 3500, 2800, 16, 5, 0, 'Compatible black toner'],
      ['Monthly Support Contract', 'SVC-SUPPORT-MTH', 'Services', '', 15000, 0, 16, 0, 0, 'Monthly IT support retainer'],
    ]
    const notes = [
      [`Categories: ${categories}`],
      ['Tax Rate: enter 16 for 16% VAT, 0 for exempt'],
      ['Min Stock: low-stock alert threshold (0 = no alert)'],
      ['Warranty Months: 0 for non-warrantied items'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows, [], ['--- NOTES ---'], ...notes])
    ws['!cols'] = [
      { wch: 32 }, { wch: 22 }, { wch: 20 }, { wch: 16 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 45 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')
    XLSX.writeFile(wb, 'deed_products_template.xlsx')
  }

  // ── Product bulk import from Excel/CSV ──
  const handleProductImportFile = async (file: File) => {
    try {
      const rows = await readXlsx(file)
      if (!rows.length) { showToast('File is empty or unreadable', 'error'); return }
      const parsed: ProductImportRow[] = rows.map(row => {
        const sku = col(row, 'SKU', 'sku', 'Sku')
        const name = col(row, 'Name', 'name', 'Product Name', 'product_name')
        const exists = products.some(p => p.sku === sku && sku !== '')
        return {
          name, sku,
          category: col(row, 'Category', 'category') || 'Laptops',
          barcode: col(row, 'Barcode', 'barcode'),
          salePrice: Number(col(row, 'Sale Price', 'SalePrice', 'salePrice', 'sale_price')) || 0,
          costPrice: Number(col(row, 'Cost Price', 'CostPrice', 'costPrice', 'cost_price')) || 0,
          taxRate: Number(col(row, 'Tax Rate', 'TaxRate', 'taxRate', 'tax_rate')) || 16,
          minStock: Number(col(row, 'Min Stock', 'MinStock', 'Reorder Level', 'minStock')) || 5,
          warrantyMonths: Number(col(row, 'Warranty Months', 'WarrantyMonths', 'warrantyMonths')) || 12,
          description: col(row, 'Description', 'description'),
          status: (exists ? 'exists' : 'new') as 'new' | 'exists',
        }
      }).filter(r => r.name || r.sku)
      if (!parsed.length) { showToast('No valid rows found — check column headers', 'error'); return }
      setImportRows(parsed)
      setShowImportModal(true)
    } catch {
      showToast('Could not read file', 'error')
    }
  }

  const confirmProductImport = () => {
    const newRows = importRows.filter(r => r.status === 'new')
    newRows.forEach(row => {
      const cfg = CATEGORY_CONFIG[row.category as CategoryId]
      addProduct({
        name: row.name, sku: row.sku, barcode: row.barcode,
        category: (ALL_CATEGORIES.includes(row.category as CategoryId) ? row.category : 'Laptops') as CategoryId,
        salePrice: row.salePrice, costPrice: row.costPrice, taxRate: row.taxRate,
        minStock: row.minStock, warrantyMonths: row.warrantyMonths, description: row.description,
        canBeSold: true, canBePurchased: true, image: '📦', isActive: true, stockQty: 0,
        requiresSerial: cfg?.serialRequired ?? false, unit: cfg?.trackStock ? 'pcs' : 'service',
      })
    })
    showToast(`Imported ${newRows.length} product${newRows.length !== 1 ? 's' : ''}`, 'success')
    setShowImportModal(false)
    setImportRows([])
  }

  // ── Opening stock Excel upload ──
  const handleOpeningImportFile = async (file: File) => {
    try {
      const rows = await readXlsx(file)
      if (!rows.length) { showToast('File is empty', 'error'); return }
      const errors: string[] = []
      const lines = rows.map((row, i) => {
        const sku = col(row, 'SKU', 'sku', 'Sku')
        const name = col(row, 'Name', 'name', 'Product Name', 'product_name')
        const product = stockableProducts.find(p =>
          (sku && p.sku.toLowerCase() === sku.toLowerCase()) ||
          (name && p.name.toLowerCase() === name.toLowerCase())
        )
        if (!product) errors.push(`Row ${i + 2}: product "${name || sku}" not found`)
        const locRaw = col(row, 'Location', 'location').toLowerCase().replace(/\s+/g, '_')
        const locMap: Record<string, LocationId> = { warehouse: 'warehouse', shop: 'shop', repair_unit: 'repair_unit', repair: 'repair_unit' }
        return {
          productId: product?.id || '',
          productName: product?.name || name || sku,
          qty: col(row, 'Qty', 'qty', 'Quantity', 'quantity') || '1',
          serials: col(row, 'Serials', 'serials', 'Serial Numbers', 'serial_numbers'),
          location: (locMap[locRaw] || 'warehouse') as LocationId,
        }
      })
      setOpeningImportErrors(errors)
      setOpeningLines(prev => [...prev, ...lines])
      showToast(`Loaded ${lines.length} rows${errors.length ? ` (${errors.length} unmatched)` : ''}`, errors.length ? 'error' : 'success')
    } catch {
      showToast('Could not read file', 'error')
    }
  }

  const handleOpeningPost = () => {
    const items = openingLines.filter(line => line.productId).map(line => ({
      productId: line.productId, qty: Number(line.qty) || 0,
      serials: line.serials ? line.serials.split(/[\n,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean) : undefined,
      location: line.location,
    }))
    if (!items.length) { showToast('Add at least one opening stock line', 'error'); return }
    importOpeningStock(items)
    setShowOpening(false)
    setOpeningLines([])
  }

  const addTransferSerial = () => {
    const serial = tScanInput.trim().toUpperCase()
    if (!serial) return
    const existing = serials.find(s => s.serial === serial && s.productId === tProd?.id && s.location === tFrom)
    if (!existing) { showToast(`Serial ${serial} not found in ${LOCATIONS[tFrom].name}`, 'error'); return }
    if (tSerials.includes(serial)) { showToast('Serial already scanned', 'error'); return }
    setTSerials(prev => [...prev, serial])
    setTScanInput('')
  }

  const handleTransfer = () => {
    if (!tProd) { showToast('Select a product to transfer', 'error'); return }
    if (tFrom === tTo) { showToast('Source and destination must differ', 'error'); return }
    const qty = tProd.requiresSerial ? tSerials.length : Number(tQty) || 0
    if (qty <= 0) { showToast('Enter a valid transfer quantity', 'error'); return }
    const serialIds = tProd.requiresSerial ? serials.filter(s => tSerials.includes(s.serial) && s.productId === tProd.id).map(s => s.id) : []
    const ok = submitTransfer(tFrom, tTo, tProd.id, tProd.name, qty, serialIds, tNotes)
    if (ok) { setShowTransfer(false); setTProd(null); setTQty('1'); setTSerials([]); setTScanInput(''); setTNotes('') }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Hidden file inputs */}
      <input ref={productImportRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleProductImportFile(f); e.target.value = '' }} />
      <input ref={openingImportRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleOpeningImportFile(f); e.target.value = '' }} />

      <div className="kpi-grid">
        <StatCard label="Product Masters" value={kpis.productMasters} sub="inventory-owned catalog" color="#1B2762" icon={<Fa icon={faBoxesStacked} />} />
        <StatCard label="Validated GRNs" value={kpis.stockReceipts} sub="purchase-based stock in" color="#10B981" icon={<Fa icon={faArrowDown} />} />
        <StatCard label="Tracked Serials" value={kpis.serialTracked} sub="available serialized units" color="#3B82F6" icon={<Fa icon={faBarcode} />} />
        <StatCard label="Low Stock" value={kpis.lowStock} sub="below reorder level" color="#F59E0B" icon={<Fa icon={faTriangleExclamation} />} onClick={() => { setTab('reports'); setReportTab('low_stock') }} />
      </div>

      <div className="flex gap-2 items-center overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {([
          ['warehouse_view', '🏭 Warehouse'],
          ['product_master', '📦 Product Master'],
          ['opening_stock', '📥 Opening Stock'],
          ['stock_in', '🛒 Stock In'],
          ['stock_out', '📤 Stock Out'],
          ['transfers', '🔄 Transfers'],
          ['reports', '📋 Reports'],
        ] as [MainTab, string][]).filter(([value]) =>
          (value !== 'stock_in' && value !== 'stock_out') || canEditStock
        ).map(([value, label]) => (
          <button key={value} onClick={() => setTab(value)}
            className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-[11px] sm:text-xs transition-all border ${
              tab === value 
                ? 'bg-blue-50 border-blue-200 text-blue-900 font-bold shadow-sm' 
                : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900 font-medium'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'warehouse_view' && (() => {
        const warehouseSerials = serials.filter(s => s.location === 'warehouse' && s.status === 'available')
        const issuesSerials    = serials.filter(s => s.location === 'shop')
        const repairSerials    = serials.filter(s => s.location === 'repair_unit')
        const bulkProducts = stockableProducts.filter(p => !p.requiresSerial)
        const bulkByLoc = (loc: LocationId) => bulkProducts.map(p => ({ ...p, qty: getStockByLocation(p.id)[loc] })).filter(p => p.qty > 0)

        function quickMove(productId: string, productName: string, from: LocationId, to: LocationId, serialId?: string, qty = 1) {
          submitTransfer(from, to, productId, productName, qty, serialId ? [serialId] : [], `${LOCATIONS[from].name} → ${LOCATIONS[to].name}`)
        }
        function sendForRefurbishment(serial: typeof serials[0]) {
          createRefurbishmentJob(serial.id, 'Flagged for refurbishment from warehouse stock')
        }

        const Section = ({ title, icon, color, count, children, emptyText }: {
          title: string; icon: string; color: string; count: number; children: React.ReactNode; emptyText: string
        }) => (
          <div className="card overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-muted)' }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <p className="font-semibold text-sm text-t1">{title}</p>
              <span style={{ background: color + '20', color, borderRadius: 20, fontSize: 10, fontWeight: 700, padding: '1px 8px', marginLeft: 2 }}>{count}</span>
            </div>
            {count === 0 ? <div className="py-8 text-center text-[12px] text-t3">{emptyText}</div>
              : <div className="divide-y" style={{ borderColor: '#F9FAFB' }}>{children}</div>}
          </div>
        )

        const ActionBtn = ({ label, bg, color, onClick }: { label: string; bg: string; color: string; onClick: () => void }) => (
          <button onClick={e => { e.stopPropagation(); onClick() }}
            className="px-2.5 py-1.5 rounded-md text-[10px] font-semibold transition-opacity hover:opacity-80 shadow-sm" style={{ background: bg, color, whiteSpace: 'nowrap' }}>
            {label}
          </button>
        )

        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label="Ready for Sale" value={warehouseSerials.length + bulkByLoc('warehouse').reduce((s,p) => s+p.qty, 0)} color="#1B2762" icon={<Fa icon={faWarehouse} />} />
              <StatCard label="With Issues" value={issuesSerials.length + bulkByLoc('shop').reduce((s,p) => s+p.qty, 0)} color="#D97706" icon={<Fa icon={faTriangleExclamation} />} />
              <StatCard label="Refurbishment Unit" value={repairSerials.length + bulkByLoc('repair_unit').reduce((s,p) => s+p.qty, 0)} color="#5B21B6" icon={<Fa icon={faWrench} />} />
            </div>

            <Section title="Warehouse — Ready for Sale" icon="🏭" color="#1B2762"
              count={warehouseSerials.length + bulkByLoc('warehouse').reduce((s,p) => s+p.qty, 0)} emptyText="No stock in warehouse">
              {warehouseSerials.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-t1 truncate">{s.productName}</p>
                    <p className="font-mono text-[10px] text-t3">{s.serial}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ActionBtn label="⚠️ Move to With Issues" bg="#FEF3C7" color="#92400E" onClick={() => quickMove(s.productId, s.productName, 'warehouse', 'shop', s.id)} />
                    <ActionBtn label="🔧 Send for Refurbishment" bg="#EDE9FE" color="#5B21B6" onClick={() => sendForRefurbishment(s)} />
                  </div>
                </div>
              ))}
              {bulkByLoc('warehouse').map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-t1 truncate">{p.name}</p>
                    <p className="text-[10px] text-t3">{p.qty} units in warehouse</p>
                  </div>
                  <span className="text-[11px] text-t3 italic">Use Transfers tab to move bulk items</span>
                </div>
              ))}
            </Section>

            <Section title="With Issues" icon="⚠️" color="#D97706"
              count={issuesSerials.length + bulkByLoc('shop').reduce((s,p) => s+p.qty, 0)} emptyText="No machines with issues">
              {issuesSerials.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-t1 truncate">{s.productName}</p>
                    <p className="font-mono text-[10px] text-t3">{s.serial}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ActionBtn label="🔧 Send for Refurbishment" bg="#EDE9FE" color="#5B21B6" onClick={() => sendForRefurbishment(s)} />
                    <ActionBtn label="✓ Return to Warehouse" bg="#DCFCE7" color="#166534" onClick={() => quickMove(s.productId, s.productName, 'shop', 'warehouse', s.id)} />
                  </div>
                </div>
              ))}
              {bulkByLoc('shop').map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-t1 truncate">{p.name}</p>
                    <p className="text-[10px] text-t3">{p.qty} units with issues</p>
                  </div>
                  <span className="text-[11px] text-t3 italic">Use Transfers tab to move bulk items</span>
                </div>
              ))}
            </Section>

            <Section title="Refurbishment Unit — Internal Stock" icon="🔧" color="#5B21B6"
              count={repairSerials.length + bulkByLoc('repair_unit').reduce((s,p) => s+p.qty, 0)} emptyText="No stock currently in refurbishment">
              {repairSerials.map(s => {
                const refurbJob = refurbishmentJobs.filter(j => j.serialId === s.id).sort((a, b) => b.intakeDate.localeCompare(a.intakeDate))[0] ?? null
                const statusMeta: Record<string, { bg: string; text: string; label: string }> = {
                  queued: { bg: '#FEF3C7', text: '#92400E', label: 'Queued' },
                  assigned: { bg: '#DBEAFE', text: '#1E40AF', label: 'Assigned' },
                  in_progress: { bg: '#EDE9FE', text: '#5B21B6', label: 'In Progress' },
                  ready: { bg: '#D1FAE5', text: '#065F46', label: 'Ready to Sell' },
                  transferred: { bg: '#F3F4F6', text: '#374151', label: 'Transferred' },
                  written_off: { bg: '#FEE2E2', text: '#991B1B', label: 'Written Off' },
                }
                const meta = refurbJob ? (statusMeta[refurbJob.status] ?? { bg: '#F3F4F6', text: '#6B7280', label: refurbJob.status }) : null
                return (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border-lt)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[12px] font-semibold text-t1">{s.productName}</p>
                        <span className="font-mono text-[10px] text-t3">{s.serial}</span>
                        {refurbJob && meta && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: meta.bg, color: meta.text }}>{meta.label}</span>}
                      </div>
                      {refurbJob && (
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-t3">
                          <span>Job: <span className="font-mono font-semibold" style={{ color: '#5B21B6' }}>{refurbJob.ref}</span></span>
                          {refurbJob.assignedTechnicianName ? <span>Tech: {refurbJob.assignedTechnicianName}</span> : <span className="italic">Unassigned — manage in Refurbishment module</span>}
                        </div>
                      )}
                    </div>
                    {refurbJob?.status === 'ready' && canTransfer && (
                      <ActionBtn label="✓ Transfer to Warehouse" bg="#DCFCE7" color="#166534" onClick={() => transferToSell(refurbJob.id)} />
                    )}
                  </div>
                )
              })}
              {bulkByLoc('repair_unit').map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-lt)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-t1 truncate">{p.name}</p>
                    <p className="text-[10px] text-t3">{p.qty} units in refurbishment</p>
                  </div>
                  <span className="text-[11px] text-t3 italic">Use Transfers tab to move bulk items</span>
                </div>
              ))}
              {(repairSerials.length > 0 || bulkByLoc('repair_unit').length > 0) && (
                <div className="px-4 py-2 text-[10px]" style={{ background: '#EDE9FE', color: '#5B21B6', borderTop: '1px solid #DDD6FE' }}>
                  🔧 Manage assignments, progress &amp; transfers in the <strong>Refurbishment</strong> module
                </div>
              )}
            </Section>
          </div>
        )
      })()}

      {tab === 'product_master' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Product Master" count={filteredProducts.length}>
            <input className="form-input text-[11px] sm:text-xs py-1.5 w-full sm:w-48" placeholder="Search name / SKU..." value={search} onChange={e => setSearch(e.target.value)} />
            <select className="form-select text-[11px] sm:text-xs py-1.5 w-full sm:w-40" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="All">All categories</option>
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <button className="btn-outline text-[11px] sm:text-xs py-1.5 flex-1 sm:flex-none justify-center" onClick={downloadProductTemplate}>⬇ Template</button>
              <button className="btn-secondary text-[11px] sm:text-xs py-1.5 flex-1 sm:flex-none justify-center" onClick={() => productImportRef.current?.click()}>📥 Import</button>
              <button className="btn-primary text-[11px] sm:text-xs py-1.5 w-full sm:w-auto justify-center" onClick={openNew}>+ Create</button>
            </div>
          </PanelHeader>

          <div className="px-4 py-2.5 text-[11px]" style={{ background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.2)', color: '#92400E' }}>
            Product creation defines the item only. Stock remains zero until opening stock is posted or a purchase receipt is validated.
          </div>

        <div className="overflow-x-auto w-full">
          <div className="min-w-[800px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '120px 100px 110px 120px 80px 80px 60px' }}>
              <span>Product</span><span>Category</span><span>Product Type</span><span>Tracking Type</span>
              <span className="text-right">Reorder Level</span><span className="text-right">Current Stock</span><span></span>
            </div>
            {filteredProducts.length === 0 ? (
              <p className="py-10 text-center text-xs text-t3">No products found</p>
            ) : filteredProducts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(product => {
              const cfg = CATEGORY_CONFIG[product.category]
              return (
                <div key={product.id} className="table-row" style={{ gridTemplateColumns: '120px 100px 110px 120px 80px 80px 60px' }}>
                  <span>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 16 }}>{product.image}</span>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontWeight: 500 }}>{product.name}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{product.sku}</div>
                      </div>
                    </div>
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>{product.category}</span>
                  <span><Badge status={cfg?.trackStock ? 'active' : 'draft'} label={cfg?.trackStock ? 'Stockable' : 'Service'} /></span>
                  <span><Badge status={product.requiresSerial ? 'pending' : 'draft'} label={product.requiresSerial ? 'Serial Number' : 'None'} /></span>
                  <span className="text-right" style={{ color: 'var(--text-3)' }}>{cfg?.trackStock ? product.minStock : '—'}</span>
                  <span className="text-right" style={{ color: cfg?.trackStock ? 'var(--text-1)' : '#9CA3AF', fontWeight: 600 }}>{cfg?.trackStock ? product.stockQty : '—'}</span>
                  <span className="flex justify-end">
                    <button onClick={() => openEdit(product)} style={{ background: '#E8F3FA', border: 'none', borderRadius: 6, color: '#1B2762', padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>Edit</button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <Pagination total={filteredProducts.length} page={page} setPage={setPage} />
        </div>
      )}

      {tab === 'opening_stock' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Opening Stock" count={openingStockPosted ? 1 : 0}>
            {!openingStockPosted ? (
              <button className="btn-primary text-[11px] sm:text-xs py-1.5 w-full sm:w-auto justify-center" onClick={() => { setOpeningLines([{ productId: '', productName: '', qty: '1', serials: '', location: 'warehouse' }]); setShowOpening(true) }}>+ Post Opening Stock</button>
            ) : (
              <span style={{ fontSize: 11, color: '#059669', padding: '4px 10px', background: '#D1FAE5', borderRadius: 6 }}>Posted once and locked</span>
            )}
          </PanelHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 text-[12px]">
            <div className="card p-4">
              <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 8 }}>One-Time Initialization</div>
              <div style={{ color: 'var(--text-3)' }}>Used only when the system starts. Treated like a virtual purchase and permanently locked after posting.</div>
            </div>
            <div className="card p-4">
              <div style={{ color: '#B45309', fontWeight: 700, marginBottom: 8 }}>Rules</div>
              <div style={{ color: '#B45309' }}>• Entered once</div>
              <div style={{ color: '#B45309' }}>• Locked after posting</div>
              <div style={{ color: '#B45309' }}>• Serialized items require one serial per unit</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'stock_in' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Stock In - Purchase Receipts Only" count={validatedReceipts.length} />
          <div className="px-4 py-2.5 text-[11px]" style={{ background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.2)', color: '#92400E' }}>
            Stock can only increase through Purchase → GRN → Inventory. No manual stock-in exists in Inventory.
          </div>
        <div className="overflow-x-auto w-full">
          <div className="min-w-[800px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '100px 100px 1.5fr 90px 120px 80px 100px' }}>
              <span>GRN Ref</span><span>PO Ref</span><span>Vendor</span><span>Date</span><span>Location</span><span>Status</span><span>Result</span>
            </div>
            {validatedReceipts.length === 0 ? (
              <p className="py-10 text-center text-xs text-t3">No validated GRNs yet</p>
            ) : validatedReceipts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(receipt => (
              <div key={receipt.id} className="table-row" style={{ gridTemplateColumns: '100px 100px 1.5fr 90px 120px 80px 100px' }}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{receipt.ref}</span>
                <span className="font-mono" style={{ color: 'var(--text-3)' }}>{receipt.poRef}</span>
                <span style={{ color: 'var(--text-1)' }}>{receipt.vendorName}</span>
                <span style={{ color: 'var(--text-3)' }}>{fmtDate(receipt.date)}</span>
                <span style={{ color: 'var(--text-3)' }}>{LOCATIONS[receipt.destinationLocation].icon} {LOCATIONS[receipt.destinationLocation].name}</span>
                <span><Badge status="active" label="Validated" /></span>
                <span style={{ color: '#059669' }}>Stock added and available</span>
              </div>
            ))}
          </div>
          </div>
        <Pagination total={validatedReceipts.length} page={page} setPage={setPage} />
          {pendingReceipts.length > 0 && (
            <div className="px-4 py-3 text-[11px]" style={{ color: '#B45309' }}>
              {pendingReceipts.length} draft GRN(s) are still awaiting validation in Purchase and do not increase stock yet.
            </div>
          )}
        </div>
      )}

      {tab === 'stock_out' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Stock Out Structure" count={stockOutMoves.length} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
            {[
              { title: 'Sales', text: 'Inventory can flow to customer sales only after stock has been received.' },
              { title: 'Repair Usage', text: 'Inventory can move into repair consumption or repair unit handling.' },
              { title: 'Transfers', text: 'Inventory can move internally between allowed locations.' },
            ].map(card => (
              <div key={card.title} className="card p-4">
                <div style={{ color: 'var(--text-1)', fontWeight: 700, marginBottom: 8 }}>{card.title}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 12 }}>{card.text}</div>
              </div>
            ))}
          </div>
        <div className="overflow-x-auto w-full">
          <div className="min-w-[800px] flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '90px 1.5fr 100px 60px 100px 100px 100px' }}>
              <span>Date</span><span>Product</span><span>Type</span><span>Qty</span><span>From</span><span>To</span><span>Document</span>
            </div>
            {stockOutMoves.length === 0 ? (
              <p className="py-10 text-center text-xs text-t3">No stock out movements recorded</p>
            ) : stockOutMoves.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(move => (
              <div key={move.id} className="table-row" style={{ gridTemplateColumns: '90px 1.5fr 100px 60px 100px 100px 100px' }}>
                <span style={{ color: 'var(--text-3)' }}>{fmtDate(move.date)}</span>
                <span style={{ color: 'var(--text-1)' }}>{move.productName}</span>
                <span><Badge status={move.type === 'out' ? 'cancelled' : 'pending'} label={move.type === 'out' ? 'Sale / Usage' : 'Return'} /></span>
                <span style={{ color: '#F04438', fontWeight: 600 }}>{move.qty}</span>
                <span style={{ color: 'var(--text-3)' }}>{move.fromLocation ? LOCATIONS[move.fromLocation].name : '—'}</span>
                <span style={{ color: 'var(--text-3)' }}>{move.toLocation ? LOCATIONS[move.toLocation].name : '—'}</span>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{move.documentRef}</span>
              </div>
            ))}
          </div>
          </div>
        <Pagination total={stockOutMoves.length} page={page} setPage={setPage} />
        </div>
      )}

      {tab === 'transfers' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Internal Transfers" count={stockTransfers.length}>
            <button className="btn-primary text-[11px] sm:text-xs py-1.5 w-full sm:w-auto justify-center" onClick={() => setShowTransfer(true)}>+ New Transfer</button>
          </PanelHeader>
          <div className="px-4 py-2.5 text-[11px]" style={{ background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.2)', color: '#92400E' }}>
            Allowed internal movement structure: Main Warehouse → Shop, Main Warehouse → Repair Unit, and other controlled internal transfers.
          </div>
          <div className="overflow-x-auto w-full">
            <div className="min-w-[800px] flex flex-col">
              <div className="table-head" style={{ gridTemplateColumns: '100px 120px 120px 1.5fr 90px 80px' }}>
              <span>Ref</span><span>From</span><span>To</span><span>Items</span><span>Date</span><span>Status</span>
            </div>
            {stockTransfers.length === 0 ? (
              <p className="py-10 text-center text-xs text-t3">No internal transfers yet</p>
              ) : stockTransfers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(transfer => (
                <div key={transfer.id} className="table-row" style={{ gridTemplateColumns: '100px 120px 120px 1.5fr 90px 80px' }}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{transfer.ref}</span>
                <span style={{ color: 'var(--text-3)' }}>{LOCATIONS[transfer.fromLocation].icon} {LOCATIONS[transfer.fromLocation].name}</span>
                <span style={{ color: 'var(--text-3)' }}>{LOCATIONS[transfer.toLocation].icon} {LOCATIONS[transfer.toLocation].name}</span>
                <span style={{ color: 'var(--text-1)' }}>{transfer.lines.map(line => `${line.productName} ×${line.qty}`).join(', ')}</span>
                <span style={{ color: 'var(--text-3)' }}>{fmtDate(transfer.date)}</span>
                <span><Badge status={transfer.status === 'done' ? 'done' : 'pending'} label={transfer.status} /></span>
              </div>
            ))}
            </div>
          </div>
          <Pagination total={stockTransfers.length} page={page} setPage={setPage} />
        </div>
      )}

      {tab === 'reports' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 flex-wrap">
            {([
              ['stock_on_hand', '📦 Stock on Hand'],
              ['opening_closing', '📊 Opening vs Closing'],
              ['movements', '📋 Stock Movements'],
              ['serial_tracking', '🔖 Serial Tracking'],
              ['low_stock', '⚠️ Low Stock'],
            ] as [ReportTab, string][]).map(([value, label]) => (
              <button key={value} onClick={() => setReportTab(value)}
                className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-medium transition-all border ${
                  reportTab === value 
                    ? 'bg-blue-50 border-blue-200 text-blue-900 font-bold shadow-sm' 
                    : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="card p-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Month"><Select value={reportMonth} onChange={value => setReportMonth(value)} options={MONTH_OPTS} /></Field>
              <Field label="Category"><Select value={catFilter} onChange={value => setCatFilter(value)} options={[{ value: 'All', label: 'All categories' }, ...ALL_CATEGORIES.map(c => ({ value: c, label: c }))]} /></Field>
              <Field label="Product"><Select value={reportProductId} onChange={value => setReportProductId(value)} options={[{ value: 'All', label: 'All products' }, ...stockableProducts.map(p => ({ value: p.id, label: p.name }))]} /></Field>
            </div>
          </div>

          {reportTab === 'stock_on_hand' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Stock on Hand" count={reportFilteredProducts.length} />
              <div className="overflow-x-auto w-full">
                <div className="min-w-[800px] flex flex-col">
                  <div className="table-head" style={{ gridTemplateColumns: '1.5fr 100px 80px 60px 90px 60px 100px' }}>
                  <span>Product</span><span>Category</span><span className="text-center">Warehouse</span>
                  <span className="text-center">Shop</span><span className="text-center">Repair Unit</span>
                  <span className="text-center">Total</span><span>Status</span>
                </div>
                  {reportFilteredProducts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(product => {
                const locs = reportStats.get(product.id)?.locs ?? { warehouse: 0, shop: 0, repair_unit: 0 }
                  const total = locs.warehouse + locs.shop + locs.repair_unit
                  const isLow = total <= product.minStock && product.minStock > 0
                  return (
                      <div key={product.id} className="table-row" style={{ gridTemplateColumns: '1.5fr 100px 80px 60px 90px 60px 100px' }}>
                      <span style={{ color: 'var(--text-1)' }}>{product.name}</span>
                      <span style={{ color: 'var(--text-3)' }}>{product.category}</span>
                      <span className="text-center" style={{ color: 'var(--text-1)' }}>{locs.warehouse}</span>
                      <span className="text-center" style={{ color: 'var(--text-1)' }}>{locs.shop}</span>
                      <span className="text-center" style={{ color: 'var(--text-1)' }}>{locs.repair_unit}</span>
                      <span className="text-center" style={{ color: '#1B2762', fontWeight: 700 }}>{total}</span>
                      <span><Badge status={total === 0 ? 'cancelled' : isLow ? 'pending' : 'active'} label={total === 0 ? 'Out of Stock' : isLow ? 'Low Stock' : 'Available'} /></span>
                    </div>
                  )
                })}
                </div>
              </div>
              <Pagination total={reportFilteredProducts.length} page={page} setPage={setPage} />
            </div>
          )}

          {reportTab === 'opening_closing' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Opening vs Closing Stock" count={reportFilteredProducts.length} />
              <div className="px-4 py-2.5 text-[11px]" style={{ background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.2)', color: '#92400E' }}>
                Closing Stock = Opening + Purchases - Outflows
              </div>
              <div className="overflow-x-auto w-full">
                <div className="min-w-[800px] flex flex-col">
                  <div className="table-head" style={{ gridTemplateColumns: '1.5fr 100px 70px 80px 70px 70px 110px' }}>
                  <span>Product</span><span>Category</span><span className="text-right">Opening</span>
                  <span className="text-right">Purchases</span><span className="text-right">Outflows</span>
                  <span className="text-right">Closing</span><span className="text-right">Stock Value</span>
                </div>
                  {reportFilteredProducts.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(product => {
                const monthly = reportStats.get(product.id)?.monthly ?? { opening: 0, purchases: 0, sales: 0, usage: 0, closing: 0 }
                  return (
                      <div key={product.id} className="table-row" style={{ gridTemplateColumns: '1.5fr 100px 70px 80px 70px 70px 110px' }}>
                      <span style={{ color: 'var(--text-1)' }}>{product.name}</span>
                      <span style={{ color: 'var(--text-3)' }}>{product.category}</span>
                      <span className="text-right" style={{ color: 'var(--text-3)' }}>{monthly.opening}</span>
                      <span className="text-right" style={{ color: '#059669' }}>{monthly.purchases}</span>
                      <span className="text-right" style={{ color: '#F04438' }}>{monthly.sales + monthly.usage}</span>
                      <span className="text-right" style={{ color: '#1B2762', fontWeight: 700 }}>{monthly.closing}</span>
                      <span className="text-right" style={{ color: 'var(--text-1)' }}>{fmtKes(monthly.closing * product.costPrice)}</span>
                    </div>
                  )
                })}
                </div>
              </div>
              <Pagination total={reportFilteredProducts.length} page={page} setPage={setPage} />
            </div>
          )}

          {reportTab === 'movements' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Stock Movement Report" count={filteredReportMoves.length} />
              <div className="overflow-x-auto w-full">
                <div className="min-w-[900px] flex flex-col">
                  <div className="table-head" style={{ gridTemplateColumns: '90px 1.5fr 90px 50px 100px 100px 100px 1fr' }}>
                  <span>Date</span><span>Product</span><span>Type</span><span>Qty</span>
                  <span>Source</span><span>Destination</span><span>Document</span><span>Reason</span>
                </div>
                  {[...filteredReportMoves].reverse().slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(move => (
                    <div key={move.id} className="table-row" style={{ gridTemplateColumns: '90px 1.5fr 90px 50px 100px 100px 100px 1fr' }}>
                    <span style={{ color: 'var(--text-3)' }}>{fmtDate(move.date)}</span>
                    <span style={{ color: 'var(--text-1)' }}>{move.productName}</span>
                    <span><Badge status={move.type === 'in' ? 'active' : move.type === 'transfer' ? 'pending' : 'cancelled'} label={move.type} /></span>
                    <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{move.qty}</span>
                    <span style={{ color: 'var(--text-3)' }}>{move.fromLocation ? LOCATIONS[move.fromLocation].name : '—'}</span>
                    <span style={{ color: 'var(--text-3)' }}>{move.toLocation ? LOCATIONS[move.toLocation].name : '—'}</span>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{move.documentRef}</span>
                    <span style={{ color: 'var(--text-3)' }}>{move.reason}</span>
                  </div>
                ))}
                </div>
              </div>
              <Pagination total={filteredReportMoves.length} page={page} setPage={setPage} />
            </div>
          )}

          {reportTab === 'serial_tracking' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Serial Tracking Report" count={filteredTrackedSerials.length} />
              <div className="overflow-x-auto w-full">
                <div className="min-w-[800px] flex flex-col">
                  <div className="table-head" style={{ gridTemplateColumns: '130px 1.5fr 100px 120px 100px 90px' }}>
                  <span>Serial Number</span><span>Product</span><span>Purchase Ref</span>
                  <span>Current Location</span><span>Status</span><span>Received</span>
                </div>
                {filteredTrackedSerials.length === 0 ? (
                  <p className="py-10 text-center text-xs text-t3">No serial records found</p>
                  ) : filteredTrackedSerials.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(serial => (
                    <div key={serial.id} className="table-row" style={{ gridTemplateColumns: '130px 1.5fr 100px 120px 100px 90px' }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{serial.serial}</span>
                    <span style={{ color: 'var(--text-1)' }}>{serial.productName}</span>
                    <span className="font-mono" style={{ color: 'var(--text-3)' }}>{serial.purchaseOrderId ?? 'OPENING'}</span>
                    <span style={{ color: 'var(--text-3)' }}>{LOCATIONS[serial.location].icon} {LOCATIONS[serial.location].name}</span>
                    <span><Badge status={serial.status === 'available' ? 'active' : serial.status === 'sold' ? 'done' : serial.status === 'under_repair' ? 'pending' : 'cancelled'} label={serial.status.replace('_', ' ')} /></span>
                    <span style={{ color: 'var(--text-3)' }}>{fmtDate(serial.receivedDate)}</span>
                  </div>
                ))}
                </div>
              </div>
              <Pagination total={filteredTrackedSerials.length} page={page} setPage={setPage} />
            </div>
          )}

          {reportTab === 'low_stock' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Low Stock Alert" count={filteredLowStock.length} />
              <div className="overflow-x-auto w-full">
                <div className="min-w-[800px] flex flex-col">
                  <div className="table-head" style={{ gridTemplateColumns: '1.5fr 100px 70px 100px 70px 100px' }}>
                  <span>Product</span><span>Category</span><span className="text-right">On Hand</span>
                  <span className="text-right">Reorder Level</span><span className="text-right">Deficit</span><span>Status</span>
                </div>
                {filteredLowStock.length === 0 ? (
                  <p className="py-10 text-center text-xs text-t3">No low-stock products</p>
                  ) : filteredLowStock.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE).map(product => (
                    <div key={product.id} className="table-row" style={{ gridTemplateColumns: '1.5fr 100px 70px 100px 70px 100px' }}>
                    <span style={{ color: 'var(--text-1)' }}>{product.name}</span>
                    <span style={{ color: 'var(--text-3)' }}>{product.category}</span>
                    <span className="text-right" style={{ color: product.stockQty === 0 ? '#DC2626' : '#D97706', fontWeight: 600 }}>{product.stockQty}</span>
                    <span className="text-right" style={{ color: 'var(--text-3)' }}>{product.minStock}</span>
                    <span className="text-right" style={{ color: '#F04438', fontWeight: 600 }}>-{Math.max(0, product.minStock - product.stockQty)}</span>
                    <span><Badge status={product.stockQty === 0 ? 'cancelled' : 'pending'} label={product.stockQty === 0 ? 'Out of Stock' : 'Low Stock'} /></span>
                  </div>
                ))}
                </div>
              </div>
              <Pagination total={filteredLowStock.length} page={page} setPage={setPage} />
            </div>
          )}
        </div>
      )}

      {/* ── Product single form ── */}
      {showForm && (() => {
        const revenueAccounts = accounts.filter(a => a.type === 'revenue' && a.isActive)
        const costAccounts = accounts.filter(a => a.type === 'expense' && a.isActive)
        const acctOpt = (list: Account[]) => [
          { value: '', label: '— select account —' },
          ...list.map(a => ({ value: a.code, label: `${a.code} · ${a.name}` })),
        ]
        return (
          <Modal title={editId ? 'Edit Product Master' : 'Create Product Master'} onClose={() => setShowForm(false)} width={680}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Product Name *"><Input value={form.name} onChange={setF('name')} placeholder="e.g. Dell Latitude 5530" /></Field>
              <Field label="SKU *"><Input value={form.sku} onChange={setF('sku')} placeholder="e.g. DELL-LAT-5530" /></Field>
              <Field label="Category"><Select value={form.category} onChange={v => setF('category')(v)} options={ALL_CATEGORIES.map(c => ({ value: c, label: c }))} /></Field>
              <Field label="Barcode"><Input value={form.barcode} onChange={setF('barcode')} placeholder="Scan or enter barcode" /></Field>
              <Field label="Sale Price (KSh)"><Input type="number" value={form.salePrice} onChange={setF('salePrice')} placeholder="0" /></Field>
              <Field label="Cost Price (KSh)"><Input type="number" value={form.costPrice} onChange={setF('costPrice')} placeholder="0" /></Field>
              <Field label="Reorder Level"><Input type="number" value={form.minStock} onChange={setF('minStock')} placeholder="5" /></Field>
              <Field label="Warranty (months)"><Input type="number" value={form.warrantyMonths} onChange={setF('warrantyMonths')} placeholder="12" /></Field>
              <Field label="Tax Rate (%)"><Input type="number" value={form.taxRate} onChange={setF('taxRate')} placeholder="16" /></Field>
              <Field label="Description"><Input value={form.description} onChange={setF('description')} placeholder="Brief description" /></Field>
            </div>
            <div style={{ marginTop: 10, padding: '10px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#1E40AF', marginBottom: 8 }}>Account Mapping (Chart of Accounts)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Revenue Account (Sales)"><Select value={form.saleAccountCode} onChange={v => setF('saleAccountCode')(v)} options={acctOpt(revenueAccounts)} /></Field>
                <Field label="Cost Account (Purchases)"><Select value={form.costAccountCode} onChange={v => setF('costAccountCode')(v)} options={acctOpt(costAccounts)} /></Field>
              </div>
            </div>
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 8, fontSize: 12 }}>
              <div><span style={{ color: 'var(--text-3)' }}>Product Type: </span><span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{CATEGORY_CONFIG[form.category as CategoryId]?.trackStock ? 'Stockable' : 'Service'}</span></div>
              <div><span style={{ color: 'var(--text-3)' }}>Tracking Type: </span><span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{CATEGORY_CONFIG[form.category as CategoryId]?.serialRequired ? 'Serial Number' : 'None'}</span></div>
              <div style={{ marginTop: 8, color: '#B45309' }}>Creating a product does not add stock. Stock comes later from purchase receipt or opening stock only.</div>
            </div>
            <div className="flex gap-2 justify-end" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveProduct}>Save Product</button>
            </div>
          </Modal>
        )
      })()}

      {/* ── Product bulk import preview modal ── */}
      {showImportModal && (
        <Modal title="Import Products — Preview" onClose={() => { setShowImportModal(false); setImportRows([]) }} width={780}>
          <div className="px-1 py-2 text-[11px]" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, marginBottom: 12, color: '#166534' }}>
            <strong>{importRows.filter(r => r.status === 'new').length} new</strong> will be imported &nbsp;·&nbsp;
            <strong>{importRows.filter(r => r.status === 'exists').length} already exist</strong> (will be skipped — matched by SKU)
          </div>

          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <div className="table-scroll">
              <div className="table-head" style={{ gridTemplateColumns: '80px 1.5fr 110px 80px 80px 70px', minWidth: '510px' }}>
                <span>Status</span><span>Name</span><span>SKU</span>
                <span className="text-right">Sale Price</span><span className="text-right">Cost Price</span><span>Category</span>
              </div>
              {importRows.map((row, i) => (
                <div key={i} className="table-row" style={{ gridTemplateColumns: '80px 1.5fr 110px 80px 80px 70px', minWidth: '510px', opacity: row.status === 'exists' ? 0.5 : 1 }}>
                  <span>
                    {row.status === 'new'
                      ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#D1FAE5', color: '#065F46' }}>New</span>
                      : <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#FEE2E2', color: '#991B1B' }}>Exists</span>
                    }
                  </span>
                  <span style={{ color: 'var(--text-1)' }}>{row.name || <span className="text-t3 italic">—</span>}</span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>{row.sku || <span className="text-t3 italic">—</span>}</span>
                  <span className="text-right" style={{ color: 'var(--text-3)' }}>{row.salePrice ? fmtKes(row.salePrice) : '—'}</span>
                  <span className="text-right" style={{ color: 'var(--text-3)' }}>{row.costPrice ? fmtKes(row.costPrice) : '—'}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{row.category}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14, padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 11, color: '#92400E' }}>
            Expected columns: <strong>Name, SKU, Category, Sale Price, Cost Price, Tax Rate, Min Stock, Warranty Months, Description, Barcode</strong>
          </div>

          <div className="flex gap-2 justify-end" style={{ marginTop: 14 }}>
            <button className="btn-secondary" onClick={() => { setShowImportModal(false); setImportRows([]) }}>Cancel</button>
            <button className="btn-primary" onClick={confirmProductImport} disabled={importRows.filter(r => r.status === 'new').length === 0}>
              Import {importRows.filter(r => r.status === 'new').length} Products
            </button>
          </div>
        </Modal>
      )}

      {/* ── Opening stock modal ── */}
      {showOpening && (
        <Modal title="Post Opening Stock" onClose={() => setShowOpening(false)} width={680}>
          <p style={{ color: '#B45309', fontSize: 12, marginBottom: 14 }}>Opening stock is allowed one time only and is locked permanently after posting.</p>

          {/* Excel upload strip */}
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8 }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#0369A1', marginBottom: 2 }}>📥 Upload Excel / CSV</p>
                <p style={{ fontSize: 11, color: '#0369A1' }}>Columns: <strong>Name</strong> or <strong>SKU</strong>, <strong>Qty</strong>, <strong>Serials</strong> (optional), <strong>Location</strong></p>
              </div>
              <button className="btn-secondary text-[11px]" onClick={() => openingImportRef.current?.click()}>Choose File</button>
            </div>
            {openingImportErrors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#DC2626' }}>
                {openingImportErrors.map((e, i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {openingLines.map((line, index) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_80px_1fr_130px_32px] gap-3 items-end sm:items-start p-3 sm:p-0 rounded-lg sm:rounded-none bg-gray-50 sm:bg-transparent border sm:border-none border-gray-200">
                <SearchPicker
                  label="" placeholder="Select product..."
                  items={stockableProducts} value={line.productId}
                  onSelect={product => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, productId: product.id, productName: product.name } : entry))}
                />
                <Input type="number" value={line.qty}
                  onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, qty: value } : entry))} placeholder="Qty" />
                {products.find(p => p.id === line.productId)?.requiresSerial ? (
                  <Input value={line.serials}
                    onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, serials: value } : entry))} placeholder="SN1, SN2, SN3" />
                ) : <div className="hidden sm:block" />}
                <Select value={line.location}
                  onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, location: value as LocationId } : entry))} options={locationOpts} />
                <button onClick={() => setOpeningLines(prev => prev.filter((_, row) => row !== index))}
                  className="bg-red-50 text-red-600 rounded-md p-2 hover:bg-red-100 transition-colors w-full sm:w-auto h-[36px] sm:mt-[2px] flex items-center justify-center">✕</button>
              </div>
            ))}
          </div>

          <button onClick={() => setOpeningLines(prev => [...prev, { productId: '', productName: '', qty: '1', serials: '', location: 'warehouse' }])}
            style={{ background: 'none', border: '1px dashed #D1D5DB', borderRadius: 6, color: '#9CA3AF', padding: '6px 14px', fontSize: 12, cursor: 'pointer', marginTop: 10, width: '100%' }}>
            + Add Row Manually
          </button>

          <div className="flex gap-2 justify-end" style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={() => setShowOpening(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleOpeningPost}>Post Opening Stock</button>
          </div>
        </Modal>
      )}

      {/* ── Transfer modal ── */}
      {showTransfer && (
        <Modal title="Internal Stock Transfer" onClose={() => setShowTransfer(false)}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Source Location"><Select value={tFrom} onChange={value => setTFrom(value as LocationId)} options={locationOpts} /></Field>
              <Field label="Destination Location"><Select value={tTo} onChange={value => setTTo(value as LocationId)} options={locationOpts} /></Field>
            </div>
            <Field label="Product">
              <SearchPicker label="" placeholder="Select product..." items={stockableProducts} value={tProd?.id ?? ''} onSelect={product => { setTProd(product); setTSerials([]) }} renderItem={product => `${product.name} (on hand: ${product.stockQty})`} />
            </Field>
            {tProd && !tProd.requiresSerial && <Field label="Quantity"><Input type="number" value={tQty} onChange={setTQty} /></Field>}
            {tProd?.requiresSerial && (
              <Field label={`Serial Numbers (${tSerials.length} scanned)`}>
                <div className="flex gap-2">
                  <Input value={tScanInput} onChange={setTScanInput} placeholder="Scan serial number..." />
                  <button className="btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={addTransferSerial}>Add</button>
                </div>
                {tSerials.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {tSerials.map(serial => (
                      <span key={serial} onClick={() => setTSerials(prev => prev.filter(x => x !== serial))}
                        style={{ background: '#E8F3FA', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: '#1B2762', cursor: 'pointer', border: '1px solid #A8D4E8' }}>
                        {serial} ✕
                      </span>
                    ))}
                  </div>
                )}
              </Field>
            )}
            <Field label="Notes"><Input value={tNotes} onChange={setTNotes} placeholder="Transfer notes" /></Field>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setShowTransfer(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleTransfer}>Validate Transfer</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
