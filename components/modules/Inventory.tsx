'use client'
import React, { useMemo, useState, useRef, useEffect, Suspense } from 'react'
import { loadXlsx } from '@/lib/xlsx-lazy'
import {
  useInventoryStore, Product, LOCATIONS, LocationId, CATEGORY_CONFIG, ALL_CATEGORIES, CategoryId,
  fmtKes, fmtDate, Account, AdjReason, SerialNumber,
  PRODUCT_KIND_OPTIONS, UOM_OPTIONS, inferProductKind, defaultTrackingForKind, defaultUnitForKind,
  kindRequiresInventoryAccounts, applyCategoryAccountDefaults, resolveProductAccounts,
} from '@/lib/store'
import type { ProductKind } from '@/lib/product-kind'
import { Badge, Modal, Field, Input, Select, Confirm, PanelHeader, SearchPicker, ModuleSkeleton, ModuleHeader, TabBar, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { PrimaryActionButton, TablePageLayout, OperationalSummary, CompactInfoNotice, StatusBadge } from '@/components/erp'
import { Fa, faBox, faBoxesStacked, faArrowDown, faBarcode, faTriangleExclamation, faWarehouse, faWrench, faPrint, faIndustry, faMagnifyingGlass } from '@/components/icons'
import { printProductLabels, printSerialLabels } from '@/lib/product-label'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import { Barcode } from '@/components/modules/Barcode'
import { inferTrackingMethod, isSerialTracking, isStockTracked, isSerialOnlyCategory, type TrackingMethod } from '@/lib/inventory-identifiers'
import InventoryProductsPanel from '@/components/inventory/InventoryProductsPanel'
import { canValidatePurchaseReceipt, canReleaseHeldSerial } from '@/lib/inventory/permissions'
import { isOpeningStockMove } from '@/lib/inventory/opening-stock'
import { explainSerialWhereabouts, findSerialMatches } from '@/lib/inventory/serial-trace'
import { ScanInputRow } from '@/components/BarcodeScanner'
import { identityMatchesScan, parseScanPayload } from '@/lib/barcode-scan'
import { getCategoryMarkupPct, suggestSalePriceFromCost, quoteSalePriceFromCost } from '@/lib/sale-price-calculator'
import { normalizePricingMarginPolicy } from '@/lib/pricing/margin-policy'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'

type MainTab = 'warehouse_view' | 'product_master' | 'movements' | 'product_catalog' | 'opening_stock' | 'stock_in' | 'stock_out' | 'transfers' | 'adjustments' | 'stock_take' | 'reports'
type ReportTab = 'stock_on_hand' | 'opening_closing' | 'movements' | 'serial_tracking' | 'serial_lookup' | 'low_stock' | 'valuation'
const MAIN_TABS: MainTab[] = ['warehouse_view', 'product_master', 'movements', 'product_catalog', 'opening_stock', 'stock_in', 'stock_out', 'transfers', 'adjustments', 'stock_take', 'reports']
const INVENTORY_TAB_ALIASES: Record<string, MainTab> = {
  warehouse: 'warehouse_view',
  products: 'product_master',
  movement: 'movements',
  'stock-take': 'stock_take',
}
const resolveInventoryTab = (raw: string | null): MainTab | null => {
  if (!raw) return null
  if (INVENTORY_TAB_ALIASES[raw]) return INVENTORY_TAB_ALIASES[raw]
  return MAIN_TABS.includes(raw as MainTab) ? raw as MainTab : null
}

type ProductImportRow = {
  name: string; sku: string; category: string; barcode: string
  salePrice: number; costPrice: number; taxRate: number
  minStock: number; warrantyMonths: number; description: string
  productKind?: ProductKind
  unit?: string
  saleAccountCode?: string; costAccountCode?: string; inventoryAccountCode?: string
  cogsAccountCode?: string; adjustmentAccountCode?: string; writeOffAccountCode?: string
  priceDifferenceAccountCode?: string
  skuProvided?: boolean
  status: 'new' | 'exists' | 'duplicate' | 'invalid'
  reason?: string
}

type PriceUpdateRow = {
  productId: string
  productName: string
  sku: string
  currentSalePrice: number
  newSalePrice: number
  currentCostPrice: number
  newCostPrice: number
  reason: string
  effectiveDate: string
  status: 'valid' | 'unchanged' | 'invalid'
  reasonText?: string
}

type OpeningStockLine = {
  productId: string
  productName: string
  qty: string
  serials: string
  serialSkus: string
  location: LocationId
}

const INTERNAL_LOCS = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).map(k => ({
  value: k,
  label: `${LOCATIONS[k].icon} ${LOCATIONS[k].name}`,
}))

const blankProduct = () => {
  const category = 'Laptops' as CategoryId
  const defaults = applyCategoryAccountDefaults(category, {})
  const productKind = defaults.productKind
  const trackingMethod = defaultTrackingForKind(productKind, category)
  return {
    name: '', sku: '', barcode: '', category,
    productKind,
    trackingMethod,
    salePrice: '', costPrice: '', taxRate: '16', minStock: '5',
    unit: defaultUnitForKind(productKind, trackingMethod),
    invoicePolicy: 'order' as 'order' | 'delivery',
    pricingCategoryId: '',
    description: '', canBeSold: true, canBePurchased: true, image: '',
    isActive: true, warrantyMonths: '12',
    saleAccountCode: defaults.saleAccountCode || '',
    costAccountCode: defaults.costAccountCode || '',
    inventoryAccountCode: defaults.inventoryAccountCode || '',
    cogsAccountCode: defaults.cogsAccountCode || '',
    adjustmentAccountCode: defaults.adjustmentAccountCode || '',
    writeOffAccountCode: defaults.writeOffAccountCode || '',
    priceDifferenceAccountCode: defaults.priceDifferenceAccountCode || '',
    parentId: '',
  }
}

const normalizeBarcodeSeed = (value: string) => value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)
const buildProductSku = (name: string, existing: Product[] = [], salt = 0) => {
  const seed = normalizeBarcodeSeed(name).slice(0, 18) || 'PRODUCT'
  // Include salt so bulk rows generated in the same millisecond never collide.
  let candidate = `${seed}-${Date.now().toString(36).toUpperCase().slice(-5)}${salt ? `-${salt}` : ''}`
  let suffix = 1
  while (existing.some(p => p.sku?.toUpperCase() === candidate.toUpperCase())) {
    candidate = `${seed}-${Date.now().toString(36).toUpperCase().slice(-5)}-${salt || suffix++}`
    suffix++
  }
  return candidate
}

const isProductImportNotesRow = (name: string) => {
  const n = name.trim()
  if (!n) return true
  if (n.startsWith('---')) return true
  return /^(categories|product type|tax rate|min stock|warranty months|barcode|sku|account columns|storable products)\b/i.test(n)
}
const buildProductBarcode = (sku: string, name: string, existing: Product[] = [], currentId?: string) => {
  const seed = normalizeBarcodeSeed(sku || name) || 'ITEM'
  let candidate = `DEED-${seed}-${Date.now().toString().slice(-5)}`
  let suffix = 1
  while (existing.some(p => p.id !== currentId && p.barcode?.toUpperCase() === candidate.toUpperCase())) {
    candidate = `DEED-${seed}-${Date.now().toString().slice(-5)}-${suffix++}`
  }
  return candidate
}

const MONTH_OPTS = [
  { value: '01', label: 'Jan' }, { value: '02', label: 'Feb' }, { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' }, { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' }, { value: '08', label: 'Aug' }, { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dec' },
]

async function readXlsx(file: File): Promise<any[]> {
  const XLSX = await loadXlsx()
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

const normKey = (value: unknown) => String(value ?? '').trim().toLowerCase()

type ProductListRow = {
  id: string
  product: Product
  kind: 'standalone' | 'parent' | 'variant'
  variants?: Product[]
  isExpanded?: boolean
}

export default function Inventory() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <InventoryContent />
    </Suspense>
  )
}

function InventoryContent() {
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const {
    products, productPriceHistory, addProduct, publishProductBulk, updateProduct, updateProductPrice,
    serials, stockMoves, stockTransfers,
    createTransfer, addTransferLine, validateTransfer, submitTransfer,
    importOpeningStock, openingStockPosted,
    getStockByLocation, getMonthlyMovements,
    purchaseOrders, receipts,
    showToast, currentUserId, users, accounts,
    refurbishmentJobs, createRefurbishmentJob, transferToSell,
    systemSettings,
    bulkStock,
    stockAdjustments, createAdjustment, approveAdjustment,
    saleOrders, releaseSerialToStock,
    normalizeInventoryTags,
  } = useInventoryStore()

  const [tab, setTab] = useState<MainTab>('product_catalog')
  const [reportTab, setReportTab] = useState<ReportTab>('stock_on_hand')
  const [valuationReport, setValuationReport] = useState<{
    totals?: { onHand: number; valuationQty: number; totalValue: number; impliedListValue: number; driftLines: number }
    rows?: Array<{ productId: string; sku: string; name: string; onHand: number; valuationQty: number; qtyDrift: number; averageCost: number; totalValue: number; listCost: number; impliedListValue: number }>
    error?: string
    loading?: boolean
  } | null>(null)


  useEffect(() => {
    // One-shot heal: rewrite INV-* tags so Tag = manufacturer serial.
    void normalizeInventoryTags()
  }, [normalizeInventoryTags])

  useEffect(() => {
    const syncTabFromUrl = () => {
      const requested = resolveInventoryTab(new URLSearchParams(window.location.search).get('tab'))
      if (requested) {
        setTab(requested)
        if (requested === 'movements') setReportTab('movements')
      }
    }
    syncTabFromUrl()
    window.addEventListener('popstate', syncTabFromUrl)
    return () => window.removeEventListener('popstate', syncTabFromUrl)
  }, [])

  const setActiveTab = (next: MainTab) => {
    setTab(next)
    if (next === 'movements') setReportTab('movements')
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (next === 'product_catalog') url.searchParams.delete('tab')
      else url.searchParams.set('tab', next)
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogCatFilter, setCatalogCatFilter] = useState('All')
  /** All = full sellable catalog (incl. zero stock). In stock / Out of stock narrow the list. */
  const [catalogStockFilter, setCatalogStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all')
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(5, 7))
  const [reportProductId, setReportProductId] = useState('All')
  const [serialLookupQuery, setSerialLookupQuery] = useState('')
  const [serialReportStatus, setSerialReportStatus] = useState<'all' | SerialNumber['status']>('all')
  const [serialReportSearch, setSerialReportSearch] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useUrlRecordId({ param: 'edit' })
  const [form, setForm] = useState<any>(blankProduct())
  const restoredEditRef = useRef<string | null>(null)

  const [showOpening, setShowOpening] = useState(false)
  const [openingLines, setOpeningLines] = useState<OpeningStockLine[]>([])

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
  const [importBusy, setImportBusy] = useState(false)
  const [importRows, setImportRows] = useState<ProductImportRow[]>([])

  // Opening stock Excel upload
  const openingImportRef = useRef<HTMLInputElement>(null)
  const [openingImportErrors, setOpeningImportErrors] = useState<string[]>([])

  // Refurbishment send-to state (warehouse safety modal)
  const [showNewRefurb, setShowNewRefurb] = useState(false)
  const [refurbSerial, setRefurbSerial] = useState<{ id: string; serial: string; productName: string } | null>(null)
  const [refurbIssueDesc, setRefurbIssueDesc] = useState('')
  const [warehouseSearchDraft, setWarehouseSearchDraft] = useState('')
  const [warehouseSearch, setWarehouseSearch] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string
    message: string
    detail?: string
    confirmLabel: string
    confirmColor?: string
    action: () => void
  } | null>(null)

  // Stock adjustment state
  const [showAdjForm, setShowAdjForm] = useState(false)
  const [adjFilter, setAdjFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [adjForm, setAdjForm] = useState<{
    productId: string; productName: string
    type: 'add' | 'subtract'; qty: string; reason: AdjReason; notes: string
  }>({ productId: '', productName: '', type: 'subtract', qty: '', reason: 'count_correction', notes: '' })

  // Stock take (cycle count) state
  const [stockTakeLines, setStockTakeLines] = useState<{ productId: string; productName: string; systemQty: number; countedQty: string }[]>([])
  const [stockTakeStarted, setStockTakeStarted] = useState(false)
  const [stockTakeFilter, setStockTakeFilter] = useState('all')

  // Product label print state
  const [labelProduct, setLabelProduct] = useState<Product | null>(null)
  const [labelQty, setLabelQty] = useState('1')

  // Product catalog / price list state
  const priceImportRef = useRef<HTMLInputElement>(null)
  const [priceProduct, setPriceProduct] = useState<Product | null>(null)
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null)
  const [showPriceImport, setShowPriceImport] = useState(false)
  const [priceRows, setPriceRows] = useState<PriceUpdateRow[]>([])
  const [priceForm, setPriceForm] = useState({ salePrice: '', costPrice: '', reason: '', effectiveDate: new Date().toISOString().slice(0, 10) })

  // Duplicate & variant state
  const [dupConfirm, setDupConfirm] = useState(false)
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const [showAcctMapping, setShowAcctMapping] = useState(false)

  const setF = (key: string) => (value: any) => setForm((prev: any) => ({ ...prev, [key]: value }))

  const stockableProducts = useMemo(
    () => products.filter(p => isStockTracked(inferTrackingMethod({
      trackingMethod: p.trackingMethod,
      category: p.category,
      requiresSerial: p.requiresSerial,
      unit: p.unit,
    })) && p.isActive),
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

  // Group products by parent — orphaned variants (parent inactive/missing) float to top level
  const allActiveIds = useMemo(() => new Set(products.filter(p => p.isActive).map(p => p.id)), [products])
  const orphanedVariantIds = useMemo(() => new Set(
    products.filter(p => p.parentId && !allActiveIds.has(p.parentId)).map(p => p.id)
  ), [products, allActiveIds])
  const productGroups = useMemo(() => {
    const filteredIds = new Set(filteredProducts.map(p => p.id))
    const childrenByParent: Record<string, Product[]> = {}
    const topLevel: Product[] = []
    for (const p of filteredProducts) {
      if (p.parentId && filteredIds.has(p.parentId)) {
        ;(childrenByParent[p.parentId] ??= []).push(p)
      } else {
        topLevel.push(p)
      }
    }
    return topLevel.map(p => ({ product: p, variants: childrenByParent[p.id] ?? [] }))
  }, [filteredProducts])

  const productListRows = useMemo(() => {
    const rows: ProductListRow[] = []
    for (const { product, variants } of productGroups) {
      if (variants.length === 0) {
        rows.push({ id: product.id, product, kind: 'standalone' })
        continue
      }
      const isExpanded = !collapsedParents.has(product.id)
      rows.push({ id: product.id, product, kind: 'parent', variants, isExpanded })
      if (isExpanded) {
        for (const v of variants) rows.push({ id: v.id, product: v, kind: 'variant' })
      }
    }
    return rows
  }, [productGroups, collapsedParents])

  // Live similar-name hint shown inside the product form while typing
  const nameSimilarProducts = useMemo(() => {
    if (!form.name || form.name.length < 3) return []
    const q = form.name.trim().toLowerCase()
    return products.filter(p => p.isActive && p.id !== editId && p.name.toLowerCase().includes(q)).slice(0, 3)
  }, [form.name, products, editId])

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
      const locs = getStockByLocation(p.id)
      const derivedTotal = (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
      const isLow = derivedTotal <= p.minStock && p.minStock > 0
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
      const moveMonth = String(m.date ?? '').slice(5, 7)
      if (moveMonth === reportMonth && validProductIds.has(m.productId)) {
        rMoves.push(m)
      }
    }
    const rSerials: typeof serials = []
    for (const s of serials) {
      // Include all lifecycle statuses so reserved (assigned), sold, and refurb are visible.
      if (validProductIds.has(s.productId)) {
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
  }, [stockableProducts, stockMoves, serials, bulkStock, getStockByLocation, catFilter, reportProductId, reportMonth])

  const displayedTrackedSerials = useMemo(() => {
    const q = serialReportSearch.trim().toLowerCase()
    return filteredTrackedSerials.filter(s => {
      if (serialReportStatus !== 'all' && s.status !== serialReportStatus) return false
      if (!q) return true
      return (
        s.serial.toLowerCase().includes(q) ||
        String(s.barcode || '').toLowerCase().includes(q) ||
        s.productName.toLowerCase().includes(q)
      )
    })
  }, [filteredTrackedSerials, serialReportStatus, serialReportSearch])

  const serialLookupResults = useMemo(() => {
    const matches = findSerialMatches(serialLookupQuery, serials)
    return matches.map(serial => explainSerialWhereabouts({
      serial,
      saleOrders: saleOrders.map(so => ({
        id: so.id,
        ref: so.ref,
        status: so.status,
        customerName: so.customerName,
        lines: so.lines.map(l => ({ serialIds: l.serialIds, productName: l.productName })),
      })),
      stockMoves: stockMoves.map(m => ({
        id: m.id,
        productId: m.productId,
        date: m.date,
        reason: m.reason,
        documentRef: m.documentRef,
        serialNumbers: m.serialNumbers,
        fromLocation: m.fromLocation,
        toLocation: m.toLocation,
      })),
    }))
  }, [serialLookupQuery, serials, saleOrders, stockMoves])

  const canReleaseSerials = canReleaseHeldSerial(users.find(u => u.id === currentUserId)?.role)

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

  const warehouseStock = useMemo(() => {
    const bulkProducts = stockableProducts.filter(p => !p.requiresSerial)
    const bulkByLocation = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).reduce((acc, loc) => {
      acc[loc] = bulkProducts
        .map(p => ({ ...p, qty: getStockByLocation(p.id)[loc] }))
        .filter(p => p.qty > 0)
      return acc
    }, {} as Partial<Record<LocationId, Array<(typeof bulkProducts)[number] & { qty: number }>>>)

    return {
      warehouseSerials: serials.filter(s => s.location === 'warehouse' && s.status === 'available'),
      issuesSerials: serials.filter(s => s.location === 'shop'),
      repairSerials: serials.filter(s => s.location === 'repair_unit'),
      bulkByLocation,
    }
  }, [getStockByLocation, serials, stockableProducts])

  const reportStats = useMemo(() => {
    const map = new Map<string, {
      locs: Record<string, number>;
      monthly: { opening: number; purchases: number; sales: number; usage: number; closing: number }
    }>()
    for (const p of reportFilteredProducts) {
      map.set(p.id, {
        locs: { warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0, pending_testing: 0, quarantine: 0 },
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
        // Reconfiguration (and other writers) may omit `reason` and put text in
        // `notes` instead — never call methods on reason directly here.
        if (isOpeningStockMove(m)) st.monthly.opening += m.qty
        else if (m.type === 'in') st.monthly.purchases += m.qty
        else if (m.type === 'out') st.monthly.sales += m.qty
        else if (m.type === 'transfer') st.monthly.usage += m.qty
      }
    }
    for (const st of Array.from(map.values())) {
      st.monthly.closing = st.monthly.opening + st.monthly.purchases - st.monthly.sales - st.monthly.usage
    }
    return map
  }, [reportFilteredProducts, serials, bulkStock, stockMoves])

  const openingStockRows = useMemo(() => stockMoves
    .filter(isOpeningStockMove)
    .map(move => ({
      ...move,
      product: products.find(product => product.id === move.productId),
      location: (move.toLocation ?? 'warehouse') as LocationId,
    })), [stockMoves, products])

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const canTransfer = !!currentUser && ['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(currentUser.role)
  const canEditStock = canTransfer || !systemSettings.invNoDirectStockEdits
  const canRequestAdj = !!currentUser && ['director', 'inventory_officer', 'technical_lead', 'finance_officer'].includes(currentUser.role)
  const canApproveAdj = !!currentUser && ['director', 'inventory_officer', 'technical_lead'].includes(currentUser.role)
  const canUpdatePrice = !!currentUser && ['director', 'admin_officer', 'finance_officer', 'inventory_officer'].includes(currentUser.role)

  const priceHistoryByProduct = useMemo(() => {
    const map = new Map<string, typeof productPriceHistory>()
    for (const entry of productPriceHistory) {
      map.set(entry.productId, [...(map.get(entry.productId) ?? []), entry])
    }
    return map
  }, [productPriceHistory])

  const getAvailableQty = (product: Product) => {
    if (product.unit === 'service') return Number.POSITIVE_INFINITY
    if (product.requiresSerial) {
      return serials.filter(s => s.productId === product.id && s.status === 'available').length
    }
    const byLocation = getStockByLocation(product.id)
    return (byLocation.warehouse ?? 0) + (byLocation.shop ?? 0) + (byLocation.repair_unit ?? 0)
  }

  const catalogProducts = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    return products
      .filter(product => product.isActive && product.canBeSold)
      .filter(product => {
        if (product.unit === 'service') return catalogStockFilter !== 'out_of_stock'
        const qty = getAvailableQty(product)
        if (catalogStockFilter === 'in_stock') return qty > 0
        if (catalogStockFilter === 'out_of_stock') return qty <= 0
        return true
      })
      .filter(product => catalogCatFilter === 'All' || product.category === catalogCatFilter)
      .filter(product => !q || product.name.toLowerCase().includes(q) || product.sku.toLowerCase().includes(q) || product.barcode?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, serials, bulkStock, catalogSearch, catalogCatFilter, catalogStockFilter])

  const openPriceUpdate = (product: Product) => {
    const markupSuggested = suggestSalePriceFromCost(systemSettings.invCategorySaleMarkupPct, product.category, product.costPrice, {
        policy: systemSettings.pricingMarginPolicy,
        pricingCategoryId: (product as any).pricingCategoryId,
        legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
      })
    // Prefill sale from category markup when cost exists but sale is still unset.
    const saleSeed =
      Number(product.salePrice) > 0
        ? product.salePrice
        : (markupSuggested !== null && Number(product.costPrice) > 0 ? markupSuggested : product.salePrice)
    setPriceProduct(product)
    setPriceForm({
      salePrice: String(saleSeed ?? 0),
      costPrice: String(product.costPrice ?? 0),
      reason: '',
      effectiveDate: new Date().toISOString().slice(0, 10),
    })
  }

  const submitPriceUpdate = () => {
    if (!priceProduct) return
    const salePrice = Number(priceForm.salePrice)
    // Cost is not editable here — keep the product's current cost (purchase-driven).
    const costPrice = Number(priceProduct.costPrice) || 0
    if (!Number.isFinite(salePrice) || salePrice < 0) { showToast('Enter a valid sale price', 'error'); return }
    if (!priceForm.reason.trim()) { showToast('Enter a reason for the price update', 'error'); return }
    updateProductPrice(priceProduct.id, salePrice, costPrice, priceForm.reason, priceForm.effectiveDate)
    setPriceProduct(null)
  }

  const downloadPriceUpdateTemplate = async () => {
    const XLSX = await loadXlsx()
    const headers = ['SKU', 'Product Name', 'Current Price', 'New Price', 'Current Cost Price', 'New Cost Price', 'Reason', 'Effective Date']
    const rows = catalogProducts.map(product => [
      product.sku,
      product.name,
      product.salePrice,
      product.salePrice,
      product.costPrice,
      product.costPrice,
      'Price list update',
      new Date().toISOString().slice(0, 10),
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Price Updates')
    XLSX.writeFile(wb, 'deed_price_update_template.xlsx')
  }

  const handlePriceUpdateFile = async (file: File) => {
    try {
      guardSpreadsheetFile(file)
      const rows = await readXlsx(file)
      if (!rows.length) { showToast('File is empty or unreadable', 'error'); return }
      guardSpreadsheetRows(rows)
      const parsed: PriceUpdateRow[] = rows.map((row, index) => {
        const sku = col(row, 'SKU', 'sku', 'Sku')
        const name = col(row, 'Product Name', 'Name', 'product_name', 'name')
        const product = products.find(p =>
          (sku && p.sku.toLowerCase() === sku.toLowerCase()) ||
          (!sku && name && p.name.toLowerCase() === name.toLowerCase())
        )
        const newSaleRaw = col(row, 'New Price', 'New Sale Price', 'new_price', 'newSalePrice')
        const newCostRaw = col(row, 'New Cost Price', 'New Cost', 'new_cost_price', 'newCostPrice')
        const reason = col(row, 'Reason', 'reason')
        const effectiveDate = col(row, 'Effective Date', 'effective_date') || new Date().toISOString().slice(0, 10)
        const newSalePrice = Number(newSaleRaw)
        const newCostPrice = newCostRaw ? Number(newCostRaw) : Number(product?.costPrice ?? 0)
        const reasons: string[] = []
        if (!product) reasons.push(`row ${index + 2}: product not found`)
        if (!newSaleRaw || !Number.isFinite(newSalePrice) || newSalePrice < 0) reasons.push('new price must be a non-negative number')
        if (!Number.isFinite(newCostPrice) || newCostPrice < 0) reasons.push('new cost price must be non-negative')
        if (!reason.trim()) reasons.push('reason is required')
        const unchanged = !!product && Number(product.salePrice) === newSalePrice && Number(product.costPrice) === newCostPrice
        const status: PriceUpdateRow['status'] = reasons.length ? 'invalid' : unchanged ? 'unchanged' : 'valid'
        return {
          productId: product?.id ?? '',
          productName: product?.name ?? name,
          sku: product?.sku ?? sku,
          currentSalePrice: Number(product?.salePrice ?? 0),
          newSalePrice,
          currentCostPrice: Number(product?.costPrice ?? 0),
          newCostPrice,
          reason,
          effectiveDate,
          status,
          reasonText: reasons.join('; ') || (unchanged ? 'No price change' : undefined),
        }
      }).filter(row => row.productName || row.sku)
      if (!parsed.length) { showToast('No valid rows found — check column headers', 'error'); return }
      setPriceRows(parsed)
      setShowPriceImport(true)
    } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'Could not read file', 'error')
    }
  }

  const confirmPriceImport = () => {
    const validRows = priceRows.filter(row => row.status === 'valid')
    if (!validRows.length) { showToast('No valid price rows to update', 'error'); return }
    validRows.forEach(row => {
      updateProductPrice(row.productId, row.newSalePrice, row.newCostPrice, row.reason, row.effectiveDate)
    })
    setShowPriceImport(false)
    setPriceRows([])
    showToast(`Updated ${validRows.length} product price${validRows.length !== 1 ? 's' : ''}`, 'success')
  }

  const openingStockLocationLabels: Record<'warehouse' | 'shop' | 'repair_unit', string> = {
    warehouse: 'Ready for Sale',
    shop: 'Shop / Showroom',
    repair_unit: 'Repair Unit',
  }
  const inventoryLocationIds = ['warehouse', 'shop', 'repair_unit'] as const
  const locationOpts = inventoryLocationIds.map(k => ({
    value: k,
    label: `${LOCATIONS[k].icon} ${openingStockLocationLabels[k]}`,
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

  const openNew = () => { setForm(blankProduct()); setEditId(null); setDupConfirm(false); setShowAcctMapping(false); setShowForm(true); restoredEditRef.current = null }

  const fillProductForm = (product: Product) => {
    const kind = inferProductKind(product)
    setForm({
      name: product.name, sku: product.sku, barcode: product.barcode ?? '', category: product.category,
      productKind: kind,
      trackingMethod: inferTrackingMethod({
        trackingMethod: product.trackingMethod,
        category: product.category,
        requiresSerial: product.requiresSerial,
        unit: product.unit,
      }),
      salePrice: String(product.salePrice), costPrice: String(product.costPrice), taxRate: String(product.taxRate),
      minStock: String(product.minStock),
      unit: product.unit || defaultUnitForKind(kind),
      invoicePolicy: product.invoicePolicy === 'delivery' ? 'delivery' as const : 'order' as const,
      pricingCategoryId: (product as any).pricingCategoryId ?? '',
      description: product.description ?? '',
      canBeSold: product.canBeSold, canBePurchased: product.canBePurchased, image: product.image ?? '',
      isActive: product.isActive, warrantyMonths: String(product.warrantyMonths),
      saleAccountCode: product.saleAccountCode ?? '', costAccountCode: product.costAccountCode ?? '',
      inventoryAccountCode: product.inventoryAccountCode ?? '', cogsAccountCode: product.cogsAccountCode ?? '',
      adjustmentAccountCode: product.adjustmentAccountCode ?? '', writeOffAccountCode: product.writeOffAccountCode ?? '',
      priceDifferenceAccountCode: product.priceDifferenceAccountCode ?? '',
      parentId: product.parentId ?? '',
    })
    setDupConfirm(false)
    setShowAcctMapping(!!(product.saleAccountCode || product.costAccountCode || product.inventoryAccountCode || product.cogsAccountCode))
  }

  const openEdit = (product: Product) => {
    fillProductForm(product)
    setEditId(product.id)
    setShowForm(true)
    restoredEditRef.current = product.id
  }

  const closeProductForm = () => {
    setShowForm(false)
    setDupConfirm(false)
    setEditId(null)
    restoredEditRef.current = null
  }

  // Restore product edit modal from ?edit= after refresh.
  useEffect(() => {
    if (!editId) {
      restoredEditRef.current = null
      return
    }
    if (restoredEditRef.current === editId && showForm) return
    const product = products.find(p => p.id === editId)
    if (!product) return
    fillProductForm(product)
    setShowForm(true)
    restoredEditRef.current = editId
  }, [editId, products, showForm])

  const openVariant = (parent: Product) => {
    const kind = inferProductKind(parent)
    setForm({
      ...blankProduct(),
      name: parent.name,
      category: parent.category,
      productKind: kind,
      trackingMethod: inferTrackingMethod({
        trackingMethod: parent.trackingMethod,
        category: parent.category,
        requiresSerial: parent.requiresSerial,
        unit: parent.unit,
      }),
      unit: parent.unit || defaultUnitForKind(kind),
      taxRate: String(parent.taxRate),
      image: parent.image ?? '',
      warrantyMonths: String(parent.warrantyMonths),
      canBeSold: parent.canBeSold,
      canBePurchased: parent.canBePurchased,
      saleAccountCode: parent.saleAccountCode ?? '',
      costAccountCode: parent.costAccountCode ?? '',
      inventoryAccountCode: parent.inventoryAccountCode ?? '',
      cogsAccountCode: parent.cogsAccountCode ?? '',
      adjustmentAccountCode: parent.adjustmentAccountCode ?? '',
      writeOffAccountCode: parent.writeOffAccountCode ?? '',
      priceDifferenceAccountCode: parent.priceDifferenceAccountCode ?? '',
      parentId: parent.id,
    })
    setEditId(null)
    setDupConfirm(false)
    setShowForm(true)
  }

  const saveProduct = async () => {
    if (!form.name.trim()) { showToast('Product name is required', 'error'); return }
    if (form.name.trim().length < 3) { showToast('Product name must be at least 3 characters', 'error'); return }

    // SKU is internal; generate one when omitted.
    const skuTrimmed = form.sku.trim() || buildProductSku(form.name, products)
    if (skuTrimmed) {
      const skuConflict = products.find(p => p.sku.toLowerCase() === skuTrimmed.toLowerCase() && p.id !== editId)
      if (skuConflict) { showToast(`SKU "${skuTrimmed}" is already used by "${skuConflict.name}"`, 'error'); return }
    }

    // Hard block: barcode must be unique
    const barcodeTrimmed = form.barcode.trim()
    if (barcodeTrimmed) {
      const bcConflict = products.find(p => normKey(p.barcode) === normKey(barcodeTrimmed) && p.id !== editId)
      if (bcConflict) { showToast(`Barcode "${barcodeTrimmed}" is already assigned to "${bcConflict.name}"`, 'error'); return }
    }

    // Hard block exact product-master repetition. Use variants for alternate configurations.
    if (!editId && !form.parentId) {
      const nameConflict = products.find(p => p.isActive && p.name.trim().toLowerCase() === form.name.trim().toLowerCase())
      if (nameConflict) { setDupConfirm(true); return }
    }

    const productKind = inferProductKind({
      productKind: form.productKind,
      trackingMethod: form.trackingMethod,
      category: form.category,
      unit: form.unit,
    })
    const selectedTracking = inferTrackingMethod({
      trackingMethod: form.trackingMethod || defaultTrackingForKind(productKind, form.category),
      category: form.category,
    })
    const productBarcode = barcodeTrimmed
    const needsInventoryAccounts = kindRequiresInventoryAccounts(productKind)
    const resolved = resolveProductAccounts({
      ...form,
      productKind,
      trackingMethod: selectedTracking,
    })
    if (needsInventoryAccounts && !(form.inventoryAccountCode || resolved.inventoryAccountCode)) {
      showToast('Select an Inventory Asset account for storable products (or set a category default)', 'error')
      return
    }
    if (needsInventoryAccounts && !(form.cogsAccountCode || resolved.cogsAccountCode)) {
      showToast('Select a COGS account for storable products (or set a category default)', 'error')
      return
    }
    const salePrice = Number(form.salePrice) || 0
    const costPrice = Number(form.costPrice) || 0
    if (salePrice < 0 || costPrice < 0) { showToast('Prices cannot be negative', 'error'); return }
    const payload = {
      ...form,
      sku: skuTrimmed,
      barcode: productBarcode,
      parentId: form.parentId || undefined,
      pricingCategoryId: form.pricingCategoryId || undefined,
      salePrice, costPrice,
      stockQty: 0, minStock: Number(form.minStock) || 0, taxRate: Number(form.taxRate) || 0,
      invoicePolicy: form.invoicePolicy,
      warrantyMonths: Number(form.warrantyMonths) || 0,
      productKind,
      trackingMethod: selectedTracking,
      requiresSerial: isSerialTracking(selectedTracking),
      unit: form.unit || defaultUnitForKind(productKind, selectedTracking),
      canBeSold: !!form.canBeSold,
      canBePurchased: !!form.canBePurchased,
      saleAccountCode: form.saleAccountCode || resolved.saleAccountCode,
      costAccountCode: form.costAccountCode || resolved.costAccountCode,
      inventoryAccountCode: form.inventoryAccountCode || (needsInventoryAccounts ? resolved.inventoryAccountCode : ''),
      cogsAccountCode: form.cogsAccountCode || (needsInventoryAccounts ? resolved.cogsAccountCode : ''),
      adjustmentAccountCode: form.adjustmentAccountCode || resolved.adjustmentAccountCode,
      writeOffAccountCode: form.writeOffAccountCode || resolved.writeOffAccountCode,
      priceDifferenceAccountCode: form.priceDifferenceAccountCode || resolved.priceDifferenceAccountCode,
    }
    if (editId) {
      updateProduct(editId, payload)
      setDupConfirm(false)
      setShowForm(false)
      setEditId(null)
      restoredEditRef.current = null
      return
    }
    const saved = await Promise.resolve(addProduct(payload))
    if (!saved) return
    setDupConfirm(false)
    setShowForm(false)
    setEditId(null)
    restoredEditRef.current = null
  }

  const downloadProductTemplate = async () => {
    const XLSX = await loadXlsx()
    const headers = ['Name', 'Category', 'Product Type', 'Unit', 'Barcode', 'Sale Price', 'Cost Price', 'Tax Rate', 'Min Stock', 'Warranty Months', 'Description', 'Revenue Account', 'Purchase Account', 'Inventory Asset Account', 'COGS Account', 'Adjustment Account', 'Write-off Account', 'Price Difference Account']
    const categories = ALL_CATEGORIES.join(' | ')
    const sampleRows = [
      ['HP ProBook 450 G9', 'Laptops', 'storable', 'pcs', '1234567890123', 85000, 72000, 16, 3, 12, 'Intel Core i5, 8GB RAM, 256GB SSD', '5001', '6101', '1200', '6001', '6200', '6205', '6210'],
      ['Dell OptiPlex 3000', 'Desktops', 'storable', 'pcs', '9876543210987', 75000, 63000, 16, 2, 12, 'Intel Core i3, 4GB RAM, 1TB HDD', '5001', '6101', '1200', '6001', '6200', '6205', '6210'],
      ['Cat6 Ethernet Cable 5m', 'Networking', 'consumable', 'pcs', '', 850, 500, 16, 10, 0, 'Shielded Cat6 patch cable', '5001', '6101', '', '', '', '', ''],
      ['HP LaserJet Toner CF217A', 'Parts & Components', 'consumable', 'pcs', '', 3500, 2800, 16, 5, 0, 'Compatible black toner', '5002', '6101', '', '', '', '', ''],
      ['Monthly Support Contract', 'Services', 'service', 'month', '', 15000, 0, 16, 0, 0, 'Monthly IT support retainer', '5003', '', '', '', '', '', ''],
    ]
    const notes = [
      [`Categories: ${categories}`],
      ['Product Type: storable | consumable | service'],
      ['Tax Rate: enter 16 for 16% VAT, 0 for exempt'],
      ['Min Stock: low-stock alert threshold (0 = no alert)'],
      ['Warranty Months: 0 for non-warrantied items'],
      ['Barcode: optional product-level lookup code (leave blank if not needed)'],
      ['SKU: no SKU column is needed; the system generates an internal SKU automatically'],
      ['Account columns: optional overrides; blank inherits category defaults then company fallbacks'],
      ['Storable products should include Inventory Asset and COGS (or rely on category defaults)'],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows, [], ['--- NOTES ---'], ...notes])
    ws['!cols'] = [
      { wch: 32 }, { wch: 20 }, { wch: 16 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 45 },
      { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')
    XLSX.writeFile(wb, 'deed_products_template.xlsx')
  }

  const handleProductImportFile = async (file: File) => {
    try {
      guardSpreadsheetFile(file)
      const rows = await readXlsx(file)
      if (!rows.length) { showToast('File is empty or unreadable', 'error'); return }
      guardSpreadsheetRows(rows)
      const existingSku = new Map(products.filter(p => p.sku).map(p => [normKey(p.sku), p]))
      const existingBarcode = new Map(products.filter(p => p.barcode).map(p => [normKey(p.barcode), p]))
      const existingName = new Map(products.filter(p => p.isActive && !p.parentId).map(p => [normKey(p.name), p]))
      const seenSku = new Map<string, number>()
      const seenBarcode = new Map<string, number>()
      const seenName = new Map<string, number>()
      const skuPool: Product[] = [...products]
      const parsed: ProductImportRow[] = []
      rows.forEach((row, index) => {
        const name = col(row, 'Name', 'name', 'Product Name', 'product_name')
        if (isProductImportNotesRow(name) && !col(row, 'SKU', 'sku', 'Sku') && !col(row, 'Sale Price', 'SalePrice', 'salePrice', 'sale_price')) {
          return
        }
        const providedSku = col(row, 'SKU', 'sku', 'Sku')
        const barcode = col(row, 'Barcode', 'barcode')
        const sku = providedSku || buildProductSku(name || `Product ${index + 1}`, skuPool, index + 1)
        const skuKey = normKey(sku)
        const barcodeKey = normKey(barcode)
        const nameKey = normKey(name)
        const reasons: string[] = []
        let status: ProductImportRow['status'] = 'new'

        if (!name) reasons.push('name is required')
        else if (name.trim().length < 3) reasons.push('name must be at least 3 characters')

        if (skuKey) {
          const product = existingSku.get(skuKey)
          if (product) reasons.push(`SKU already used by ${product.name}`)
          else if (seenSku.has(skuKey)) reasons.push(`duplicate SKU in file (row ${seenSku.get(skuKey)! + 2})`)
          else seenSku.set(skuKey, index)
        }
        if (barcodeKey) {
          const product = existingBarcode.get(barcodeKey)
          if (product) reasons.push(`barcode already used by ${product.name}`)
          else if (seenBarcode.has(barcodeKey)) reasons.push(`duplicate barcode in file (row ${seenBarcode.get(barcodeKey)! + 2})`)
          else seenBarcode.set(barcodeKey, index)
        }
        if (nameKey) {
          const product = existingName.get(nameKey)
          if (product) reasons.push(`exact product name already exists: ${product.name}`)
          else if (seenName.has(nameKey)) reasons.push(`duplicate product name in file (row ${seenName.get(nameKey)! + 2})`)
          else seenName.set(nameKey, index)
        }

        if (reasons.length) {
          status = reasons.some(r => r.includes('already')) ? 'exists' : reasons.some(r => r.includes('duplicate')) ? 'duplicate' : 'invalid'
        }
        const entry: ProductImportRow = {
          name, sku,
          skuProvided: !!providedSku,
          category: col(row, 'Category', 'category') || 'Laptops',
          productKind: (['storable', 'consumable', 'service'].includes(col(row, 'Product Type', 'productKind', 'product_type').toLowerCase())
            ? col(row, 'Product Type', 'productKind', 'product_type').toLowerCase()
            : undefined) as ProductKind | undefined,
          unit: col(row, 'Unit', 'UoM', 'unit') || undefined,
          barcode,
          salePrice: Number(col(row, 'Sale Price', 'SalePrice', 'salePrice', 'sale_price')) || 0,
          costPrice: Number(col(row, 'Cost Price', 'CostPrice', 'costPrice', 'cost_price')) || 0,
          taxRate: Number(col(row, 'Tax Rate', 'TaxRate', 'taxRate', 'tax_rate')) || 16,
          minStock: Number(col(row, 'Min Stock', 'MinStock', 'Reorder Level', 'minStock')) || 5,
          warrantyMonths: Number(col(row, 'Warranty Months', 'WarrantyMonths', 'warrantyMonths')) || 12,
          description: col(row, 'Description', 'description'),
          saleAccountCode: col(row, 'Revenue Account', 'Sale Account', 'saleAccountCode', 'sale_account_code'),
          costAccountCode: col(row, 'Purchase Account', 'Cost Account', 'costAccountCode', 'cost_account_code'),
          inventoryAccountCode: col(row, 'Inventory Asset Account', 'Inventory Account', 'inventoryAccountCode', 'inventory_account_code'),
          cogsAccountCode: col(row, 'COGS Account', 'cogsAccountCode', 'cogs_account_code'),
          adjustmentAccountCode: col(row, 'Adjustment Account', 'Variance Account', 'adjustmentAccountCode', 'adjustment_account_code'),
          writeOffAccountCode: col(row, 'Write-off Account', 'Write Off Account', 'writeOffAccountCode', 'write_off_account_code'),
          priceDifferenceAccountCode: col(row, 'Price Difference Account', 'priceDifferenceAccountCode', 'price_difference_account_code'),
          status,
          reason: reasons.join('; ') || undefined,
        }
        if (entry.name || entry.sku) {
          parsed.push(entry)
          if (status === 'new') skuPool.push({ sku: entry.sku, name: entry.name } as Product)
        }
      })
      if (!parsed.length) { showToast('No valid rows found — check column headers', 'error'); return }
      setImportRows(parsed)
      setShowImportModal(true)
    } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'Could not read file', 'error')
    }
  }

  const confirmProductImport = async () => {
    const newRows = importRows.filter(r => r.status === 'new')
    if (!newRows.length) {
      showToast('No new products to publish', 'info')
      return
    }
    setImportBusy(true)
    try {
      const payloads = newRows.map(row => {
        const productKind = inferProductKind({
          productKind: row.productKind,
          category: row.category,
        })
        const trackingMethod = inferTrackingMethod({
          trackingMethod: defaultTrackingForKind(productKind, row.category),
          category: row.category,
        })
        return {
          name: row.name,
          sku: row.skuProvided ? row.sku : '',
          skuProvided: !!row.skuProvided,
          barcode: row.barcode || '',
          category: (ALL_CATEGORIES.includes(row.category as CategoryId) ? row.category : 'Laptops') as CategoryId,
          productKind,
          salePrice: row.salePrice,
          costPrice: row.costPrice,
          taxRate: row.taxRate,
          minStock: row.minStock,
          warrantyMonths: row.warrantyMonths,
          description: row.description,
          saleAccountCode: row.saleAccountCode || '',
          costAccountCode: row.costAccountCode || '',
          inventoryAccountCode: row.inventoryAccountCode || '',
          cogsAccountCode: row.cogsAccountCode || '',
          adjustmentAccountCode: row.adjustmentAccountCode || '',
          writeOffAccountCode: row.writeOffAccountCode || '',
          priceDifferenceAccountCode: row.priceDifferenceAccountCode || '',
          canBeSold: true,
          canBePurchased: true,
          image: '',
          isActive: true,
          stockQty: 0,
          trackingMethod,
          requiresSerial: isSerialTracking(trackingMethod),
          unit: row.unit || defaultUnitForKind(productKind, trackingMethod),
        }
      })

      const result = await publishProductBulk(payloads)
      const previewSkipped = importRows.length - newRows.length
      const firstFail = result.failedRows?.[0]?.reason
      const parts = [
        `Published ${result.created} product${result.created !== 1 ? 's' : ''}`,
        result.skipped ? `${result.skipped} already existed` : '',
        result.failed ? `${result.failed} failed` : '',
        previewSkipped ? `${previewSkipped} skipped in preview` : '',
        result.failed && firstFail ? `Reason: ${firstFail}` : '',
      ].filter(Boolean)
      showToast(parts.join('; '), result.failed ? 'error' : result.created ? 'success' : 'info')
      setShowImportModal(false)
      setImportRows([])
    } finally {
      setImportBusy(false)
    }
  }

  const downloadOpeningInventoryTemplate = async () => {
    const XLSX = await loadXlsx()
    const headers = [
      'SKU',
      'Product Name',
      'Tracking Method',
      'Category',
      'Qty',
      'Serials',
      'Unit SKUs',
      'Location',
      'Unit Cost',
      'Sale Price',
      'Condition / Grade',
      'Supplier / Source',
      'Purchase Ref',
      'Received Date',
      'Warranty Months',
      'Notes',
    ]
    const examples = [
      [
        'LENOVOTH-V359X',
        'Lenovo ThinkPad T495s - AMD Ryzen 5 PRO 3500U, 16GB RAM, 256GB SSD',
        'SERIAL',
        'Laptops',
        3,
        'PC1J0W03, PC1J0VZH, PC1D8D20',
        'AUTO, AUTO, AUTO',
        'Ready for Sale',
        18000,
        28000,
        'Grade A',
        'Opening Balance',
        'OPENING-2026',
        new Date().toISOString().slice(0, 10),
        6,
        'One serial per unit; Unit SKUs can be custom or AUTO',
      ],
      [
        'ADP-65W-USB-C',
        '65W USB-C Laptop Charger',
        'QUANTITY',
        'Accessories',
        25,
        '',
        '',
        'Ready for Sale',
        900,
        1800,
        'New',
        'Opening Balance',
        'OPENING-2026',
        new Date().toISOString().slice(0, 10),
        0,
        'Bulk/quantity stock; no serials needed',
      ],
      [
        'FAULTY-LAPTOP-BATCH',
        'Faulty laptops awaiting diagnosis',
        'SERIAL',
        'Laptops',
        2,
        'FLT001, FLT002',
        'FAULTY-FLT001, FAULTY-FLT002',
        'Repair Unit',
        0,
        0,
        'Faulty',
        'Opening Balance',
        'OPENING-2026',
        new Date().toISOString().slice(0, 10),
        0,
        'Use Repair Unit only for items not ready to sell',
      ],
    ]
    const notes = [
      ['--- FIELD GUIDE ---'],
      ['SKU: product master SKU. Required if Product Name is not exact.'],
      ['Product Name: must already exist in Product Master, unless matched by SKU.'],
      ['Tracking Method: SERIAL for laptops/desktops/printers/networking; QUANTITY for accessories/parts.'],
      ['Qty: total units. For SERIAL items, count must equal number of serials.'],
      ['Serials: comma, semicolon, or line separated manufacturer serial numbers.'],
      ['Unit SKUs: optional per-serial SKU values in the same order as Serials. Use AUTO or leave blank to generate.'],
      ['Location: Ready for Sale, Warehouse, Shop / Showroom, With Issues, Repair Unit. Ready for Sale maps to sellable warehouse stock.'],
      ['Unit Cost / Sale Price / Condition / Supplier / Purchase Ref / Received Date / Warranty / Notes: retained for migration review and future valuation; current opening stock import ignores unsupported fields safely.'],
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...examples, [], ...notes])
    ws['!cols'] = headers.map((header, index) => ({ wch: Math.max(16, String(header).length + (index < 2 ? 18 : 4)) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Opening Inventory')
    XLSX.writeFile(wb, 'opening_inventory_standard_template.xlsx')
  }

  const handleOpeningImportFile = async (file: File) => {
    try {
      guardSpreadsheetFile(file)
      const rows = await readXlsx(file)
      if (!rows.length) { showToast('File is empty or unreadable', 'error'); return }
      guardSpreadsheetRows(rows)
      const errors: string[] = []
      const lines = rows.map((row, i) => {
        const sku = col(row, 'SKU', 'sku', 'Sku')
        const name = col(row, 'Name', 'name', 'Product Name', 'product_name')
        const product = products.find(p =>
          (sku && normKey(p.sku) === normKey(sku)) ||
          (name && normKey(p.name) === normKey(name))
        )
        if (!product) errors.push(`Row ${i + 2}: product "${name || sku}" not found`)
        const locRaw = col(row, 'Location', 'location').toLowerCase().replace(/\s+/g, '_')
        const locMap: Record<string, LocationId> = {
          warehouse: 'warehouse',
          ready: 'warehouse',
          ready_for_sale: 'warehouse',
          ready_for_sales: 'warehouse',
          shop: 'shop',
          showroom: 'shop',
          repair_unit: 'repair_unit',
          repair: 'repair_unit',
        }
        return {
          productId: product?.id || '',
          productName: product?.name || name || sku,
          qty: col(row, 'Qty', 'qty', 'Quantity', 'quantity') || '1',
          serials: col(row, 'Serials', 'serials', 'Serial Numbers', 'serial_numbers'),
          serialSkus: col(row, 'Serial SKUs', 'serial_skus', 'Unit SKUs', 'unit_skus', 'Unit SKU', 'unit_sku'),
          location: (locMap[locRaw] || 'warehouse') as LocationId,
        }
      })
      setOpeningImportErrors(errors)
      setOpeningLines(prev => [...prev, ...lines])
      showToast(`Loaded ${lines.length} rows${errors.length ? ` (${errors.length} unmatched)` : ''}`, errors.length ? 'error' : 'success')
    } catch (err) {
      showToast(err instanceof SpreadsheetGuardError ? err.message : 'Could not read file', 'error')
    }
  }

  const openOpeningStockModal = () => {
    if (openingLines.length === 0) {
      setOpeningLines([{ productId: '', productName: '', qty: '1', serials: '', serialSkus: '', location: 'warehouse' }])
    }
    setShowOpening(true)
  }

  const handleOpeningPost = () => {
    const splitSerials = (value: string) => value.split(/[\n,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    const splitSerialSkus = (value: string) => value.split(/[\n,;]+/).map(s => s.trim().toUpperCase())
    const items = openingLines.filter(line => line.productId).map(line => ({
      productId: line.productId, qty: Number(line.qty) || 0,
      serials: line.serials ? splitSerials(line.serials) : undefined,
      serialSkus: line.serialSkus ? splitSerialSkus(line.serialSkus) : undefined,
      location: line.location,
    }))
    if (!items.length) { showToast('Add at least one opening stock line', 'error'); return }
    importOpeningStock(items)
    setShowOpening(false)
    setOpeningLines([])
  }

  const addTransferSerial = () => {
    const parsed = parseScanPayload(tScanInput)
    if (!parsed.candidates.length) return
    if (!tProd) { showToast('Select a product first', 'error'); return }
    const existing = serials.find(s =>
      s.productId === tProd.id
      && s.location === tFrom
      && identityMatchesScan(s, parsed),
    )
    if (!existing) {
      showToast(`Unit "${parsed.normalized}" not found in ${LOCATIONS[tFrom].name} for this product — try inventory barcode or serial`, 'error')
      return
    }
    if (tSerials.includes(existing.serial)) { showToast('Serial already scanned', 'error'); return }
    setTSerials(prev => [...prev, existing.serial])
    setTScanInput('')
  }

  const handleTransfer = async () => {
    if (!tProd) { showToast('Select a product to transfer', 'error'); return }
    if (tFrom === tTo) { showToast('Source and destination must differ', 'error'); return }
    const qty = tProd.requiresSerial ? tSerials.length : Number(tQty) || 0
    if (qty <= 0) { showToast('Enter a valid transfer quantity', 'error'); return }
    const serialIds = tProd.requiresSerial ? serials.filter(s => tSerials.includes(s.serial) && s.productId === tProd.id).map(s => s.id) : []
    const ok = await submitTransfer(tFrom, tTo, tProd.id, tProd.name, qty, serialIds, tNotes)
    if (ok) { setShowTransfer(false); setTProd(null); setTQty('1'); setTSerials([]); setTScanInput(''); setTNotes('') }
  }

  if (!mounted) return <ModuleSkeleton />

  const revenueAccounts = accounts.filter(a => a.type === 'revenue')
  const costAccounts = accounts.filter(a => a.type === 'expense')
  const assetAccounts = accounts.filter(a => a.type === 'asset')
  const inventoryExpenseAccounts = accounts.filter(a => a.type === 'expense')
  const acctOpt = (list: Account[]) => list.map(a => ({ value: a.code, label: `[${a.code}] ${a.name}` }))

  return (
    <div className="mod-page inventory-pilot">
      {/* Hidden file inputs */}
      <input ref={productImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleProductImportFile(f); e.target.value = '' }} />
      <input ref={openingImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleOpeningImportFile(f); e.target.value = '' }} />

      <ModuleHeader
        title="Inventory"
        subtitle="Catalog · warehouse · movements · stock control"
        icon={<Fa icon={faBoxesStacked} />}
        count={kpis.productMasters}
        color="#FFFFFF"
        subtitleMode="visible"
        primaryAction={
          canEditStock && (tab === 'product_master' || tab === 'product_catalog') ? (
            <PrimaryActionButton onClick={openNew}>New product</PrimaryActionButton>
          ) : canEditStock && (tab === 'warehouse_view' || tab === 'movements' || tab === 'transfers') ? (
            <PrimaryActionButton onClick={() => setShowTransfer(true)} hideLabelOnMobile={false}>
              Transfer stock
            </PrimaryActionButton>
          ) : undefined
        }
        overflowActions={
          canEditStock && (tab === 'product_master' || tab === 'product_catalog') ? (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                type="button"
                className="btn-secondary text-[11px] px-3 py-2"
                onClick={downloadProductTemplate}
              >
                Download template
              </button>
              <button
                type="button"
                className="btn-secondary text-[11px] px-3 py-2"
                onClick={() => productImportRef.current?.click()}
              >
                Bulk upload
              </button>
            </div>
          ) : undefined
        }
      />

      {/* KPI strip removed — stock health lives on the central dashboard */}

      <TabBar
        tabs={([
          ['product_catalog', 'Catalog'],
          ['product_master', 'Products'],
          ['warehouse_view', 'Warehouse'],
          ['movements', 'Movements'],
          ['stock_take', 'Stock take'],
          ['transfers', 'Transfers'],
          ['reports', 'Reports'],
          ['opening_stock', 'Opening stock'],
          ['stock_in', 'Stock in'],
          ['stock_out', 'Stock out'],
          ['adjustments', 'Adjustments'],
        ] as [MainTab, string][])
          .filter(([value]) => (value !== 'stock_in' && value !== 'stock_out') || canEditStock)
          .filter(([value]) => value !== 'adjustments' || canRequestAdj)
          .filter(([value]) => value !== 'stock_take' || canRequestAdj)
          .map(([id, label]) => ({ id, label }))}
        active={tab}
        onChange={id => setActiveTab(id as MainTab)}
        maxVisibleMobile={3}
        maxVisibleTablet={5}
        maxVisibleDesktop={6}
        ariaLabel="Inventory sections"
      />

      <div className="mod-body">
      <div className="inventory-pilot-rail" aria-label="Inventory overview">
        <button
          type="button"
          className={`inventory-pilot-stat ${tab === 'product_catalog' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('product_catalog')}
        >
          <span className="inventory-pilot-stat-value tabular-nums">{kpis.productMasters.toLocaleString()}</span>
          <span className="inventory-pilot-stat-label">Active products</span>
        </button>
        <button
          type="button"
          className={`inventory-pilot-stat ${tab === 'warehouse_view' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('warehouse_view')}
        >
          <span className="inventory-pilot-stat-value tabular-nums">{kpis.serialTracked.toLocaleString()}</span>
          <span className="inventory-pilot-stat-label">Available serials</span>
        </button>
        <button
          type="button"
          className={`inventory-pilot-stat ${kpis.lowStock > 0 ? 'tone-warning' : ''} ${tab === 'reports' ? 'is-active' : ''}`}
          onClick={() => { setActiveTab('reports'); setReportTab('low_stock') }}
        >
          <span className="inventory-pilot-stat-value tabular-nums">{kpis.lowStock.toLocaleString()}</span>
          <span className="inventory-pilot-stat-label">Low stock</span>
        </button>
        <button
          type="button"
          className={`inventory-pilot-stat ${tab === 'stock_in' || tab === 'movements' ? 'is-active' : ''}`}
          onClick={() => setActiveTab(canEditStock ? 'stock_in' : 'movements')}
        >
          <span className="inventory-pilot-stat-value tabular-nums">{kpis.stockReceipts.toLocaleString()}</span>
          <span className="inventory-pilot-stat-label">Validated GRNs</span>
        </button>
      </div>

      {tab === 'warehouse_view' && (() => {
        const { warehouseSerials, issuesSerials, repairSerials, bulkByLocation } = warehouseStock
        const bulkByLoc = (loc: LocationId) => bulkByLocation[loc] ?? []
        const q = warehouseSearch.trim().toLowerCase()
        const serialMatches = (s: (typeof serials)[number]) => {
          if (!q) return true
          const prod = products.find(p => p.id === s.productId)
          return (
            s.productName.toLowerCase().includes(q) ||
            s.serial.toLowerCase().includes(q) ||
            (s.sku ?? '').toLowerCase().includes(q) ||
            (s.barcode ?? '').toLowerCase().includes(q) ||
            (prod?.sku ?? '').toLowerCase().includes(q) ||
            (prod?.barcode ?? '').toLowerCase().includes(q)
          )
        }
        const productMatches = (p: { name: string; sku?: string; barcode?: string | null }) => {
          if (!q) return true
          return (
            p.name.toLowerCase().includes(q) ||
            (p.sku ?? '').toLowerCase().includes(q) ||
            (p.barcode ?? '').toLowerCase().includes(q)
          )
        }
        const filteredWarehouseSerials = warehouseSerials.filter(serialMatches)
        const filteredIssuesSerials = issuesSerials.filter(serialMatches)
        const filteredRepairSerials = repairSerials.filter(serialMatches)
        const filteredBulkWarehouse = bulkByLoc('warehouse').filter(productMatches)
        const filteredBulkShop = bulkByLoc('shop').filter(productMatches)
        const filteredBulkRepair = bulkByLoc('repair_unit').filter(productMatches)

        function quickMove(productId: string, productName: string, from: LocationId, to: LocationId, serialId?: string, qty = 1) {
          submitTransfer(from, to, productId, productName, qty, serialId ? [serialId] : [], `${LOCATIONS[from].name} → ${LOCATIONS[to].name}`)
        }

        function requestMoveToIssues(s: (typeof serials)[number]) {
          setPendingConfirm({
            title: 'Move to With Issues?',
            message: `Move ${s.productName} (${s.serial}) out of Ready for Sale into With Issues?`,
            detail: 'This unit will no longer be available to sell until it is returned to the warehouse.',
            confirmLabel: 'Move to With Issues',
            confirmColor: 'bg-amber-600',
            action: () => quickMove(s.productId, s.productName, 'warehouse', 'shop', s.id),
          })
        }

        function requestSendForRefurbishment(s: (typeof serials)[number]) {
          setRefurbSerial({ id: s.id, serial: s.serial, productName: s.productName })
          setRefurbIssueDesc('')
          setShowNewRefurb(true)
        }

        const Section = ({ title, icon, tone = 'navy', count, children, emptyText }: {
          title: string; icon: React.ReactNode; tone?: 'navy' | 'warning' | 'info'; count: number; children: React.ReactNode; emptyText: string
        }) => {
          const toneClass =
            tone === 'warning' ? 'text-[var(--warning)] bg-[var(--warning-bg)]' :
            tone === 'info' ? 'text-[var(--info)] bg-[var(--info-bg)]' :
            'text-[var(--navy)] bg-[var(--primary-light)]'
          const iconClass =
            tone === 'warning' ? 'text-[var(--warning)]' :
            tone === 'info' ? 'text-[var(--info)]' :
            'text-[var(--navy)]'
          return (
          <div className="rounded-token-md border border-[var(--border-lt)] bg-[var(--bg-card)] overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-lt)] bg-[var(--bg-surface)]">
              <span className={`text-lg ${iconClass}`} aria-hidden="true">{icon}</span>
              <p className="font-bold text-sm text-text-1">{title}</p>
              <span className={`ml-2 px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${toneClass}`}>{count}</span>
            </div>
            {count === 0 ? <div className="py-8 text-center text-[12px] text-text-3">{emptyText}</div>
              : <div className="divide-y divide-[var(--border-lt)]">{children}</div>}
          </div>
          )
        }

        const ActionBtn = ({ label, tone = 'secondary', onClick }: { label: React.ReactNode; tone?: 'secondary' | 'warning' | 'danger' | 'success' | 'primary'; onClick: () => void }) => {
          const toneCls =
            tone === 'warning' ? 'bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning)]/30' :
            tone === 'danger' ? 'bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger)]/30' :
            tone === 'success' ? 'bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success)]/30' :
            tone === 'primary' ? 'bg-[var(--primary-light)] text-[var(--navy)] border-[var(--primary)]/25' :
            'bg-[var(--bg-muted)] text-[var(--text-2)] border-[var(--border)]'
          return (
          <button type="button" onClick={e => { e.stopPropagation(); onClick() }}
            className={`px-2.5 py-1.5 min-h-[36px] rounded-md text-[10px] font-bold border transition-opacity hover:opacity-90 active:scale-[0.98] cursor-pointer whitespace-nowrap ${toneCls}`}>
            {label}
          </button>
          )
        }

        const applyWarehouseSearch = () => setWarehouseSearch(warehouseSearchDraft.trim())

        return (
          <div className="flex flex-col gap-4">
            <form
              className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center inventory-pilot-search"
              onSubmit={e => { e.preventDefault(); applyWarehouseSearch() }}
            >
              <div className="relative flex-1 min-w-0">
                <Fa icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-4 text-[12px]" aria-hidden="true" />
                <input
                  type="search"
                  value={warehouseSearchDraft}
                  onChange={e => setWarehouseSearchDraft(e.target.value)}
                  placeholder="Search by serial, product, SKU, or barcode…"
                  aria-label="Search warehouse stock"
                  className="form-input w-full pl-9 text-[12px]"
                />
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="submit" className="btn-primary text-[11px] px-4 py-2 inline-flex items-center gap-1.5">
                  <Fa icon={faMagnifyingGlass} aria-hidden="true" /> Search
                </button>
                {warehouseSearch && (
                  <button
                    type="button"
                    className="btn-secondary text-[11px] px-3 py-2"
                    onClick={() => { setWarehouseSearch(''); setWarehouseSearchDraft('') }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
            {warehouseSearch && (
              <p className="text-[11px] text-text-3 -mt-2">
                Showing matches for <span className="font-semibold text-text-2">“{warehouseSearch}”</span>
              </p>
            )}

            <div className="inventory-warehouse-board">
            <Section title="Warehouse — Ready for Sale" icon={<Fa icon={faIndustry} />} tone="navy"
              count={filteredWarehouseSerials.length + filteredBulkWarehouse.reduce((s,p) => s+p.qty, 0)}
              emptyText={q ? 'No warehouse stock matches this search' : 'No stock in warehouse'}>
              {filteredWarehouseSerials.map(s => {
                const prod = products.find(p => p.id === s.productId)
                return (
                <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-text-1 truncate" title={s.productName}>{s.productName}</p>
                    <p className="font-mono text-[10px] text-text-3 tabular-nums">{s.serial}</p>
                    <p className="font-mono text-[9px] text-primary-700">SKU: {s.sku ?? prod?.sku ?? '—'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionBtn label={<><Fa icon={faPrint} /> Label</>} tone="primary" onClick={() => printSerialLabels([{ serial: s.serial, barcode: s.barcode, productName: s.productName, sku: s.sku ?? prod?.sku ?? '', salePrice: prod?.salePrice, category: prod?.category }])} />
                    <ActionBtn label={<><Fa icon={faTriangleExclamation} /> Move to With Issues</>} tone="warning" onClick={() => requestMoveToIssues(s)} />
                    <ActionBtn label={<><Fa icon={faWrench} /> Send for Refurbishment</>} tone="secondary" onClick={() => requestSendForRefurbishment(s)} />
                  </div>
                </div>
                )
              })}
              {filteredBulkWarehouse.map(p => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-text-1 truncate" title={p.name}>{p.name}</p>
                    <p className="text-[10px] text-text-3"><span className="tabular-nums font-semibold">{p.qty}</span> units in warehouse</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionBtn label={<><Fa icon={faPrint} /> Print {p.qty} Label{p.qty !== 1 ? 's' : ''}</>} tone="primary" onClick={() => printProductLabels(p, p.qty)} />
                    <span className="text-[10px] text-text-4 italic self-center">Use Transfers tab to move bulk items</span>
                  </div>
                </div>
              ))}
            </Section>

            <Section title="With Issues" icon={<Fa icon={faTriangleExclamation} />} tone="warning"
              count={filteredIssuesSerials.length + filteredBulkShop.reduce((s,p) => s+p.qty, 0)}
              emptyText={q ? 'No With Issues stock matches this search' : 'No machines with issues'}>
              {filteredIssuesSerials.map(s => (
                <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-text-1 truncate" title={s.productName}>{s.productName}</p>
                    <p className="font-mono text-[10px] text-text-3 tabular-nums">{s.serial}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionBtn label={<><Fa icon={faWrench} /> Send for Refurbishment</>} tone="secondary" onClick={() => requestSendForRefurbishment(s)} />
                    <ActionBtn label="Return to Warehouse" tone="success" onClick={() => quickMove(s.productId, s.productName, 'shop', 'warehouse', s.id)} />
                  </div>
                </div>
              ))}
              {filteredBulkShop.map(p => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-text-1 truncate" title={p.name}>{p.name}</p>
                    <p className="text-[10px] text-text-3"><span className="tabular-nums font-semibold">{p.qty}</span> units with issues</p>
                  </div>
                  <span className="text-[10px] text-text-4 italic">Use Transfers tab to move bulk items</span>
                </div>
              ))}
            </Section>

            <Section title="Refurbishment Unit — Internal Stock" icon={<Fa icon={faWrench} />} tone="info"
              count={filteredRepairSerials.length + filteredBulkRepair.reduce((s,p) => s+p.qty, 0)}
              emptyText={q ? 'No refurbishment stock matches this search' : 'No stock currently in refurbishment'}>
              {filteredRepairSerials.map(s => {
                const refurbJob = refurbishmentJobs.filter(j => j.serialId === s.id).sort((a, b) => b.intakeDate.localeCompare(a.intakeDate))[0] ?? null
                const REFURB_STATUS_LABEL: Record<string, string> = {
                  queued: 'Queued',
                  assigned: 'Assigned',
                  in_progress: 'In Progress',
                  ready: 'Ready to Sell',
                  transferred: 'Transferred',
                  written_off: 'Written Off',
                }
                return (
                  <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[12px] font-bold text-text-1">{s.productName}</p>
                        <span className="font-mono text-[10px] text-text-3 tabular-nums">{s.serial}</span>
                        {refurbJob && (
                          <StatusBadge
                            status={refurbJob.status}
                            label={REFURB_STATUS_LABEL[refurbJob.status] ?? refurbJob.status.replace(/_/g, ' ')}
                            size="xs"
                          />
                        )}
                      </div>
                      {refurbJob && (
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-text-4">
                          <span>Job: <span className="font-mono font-bold text-primary-600">{refurbJob.ref}</span></span>
                          {refurbJob.assignedTechnicianName ? <span>Tech: {refurbJob.assignedTechnicianName}</span> : <span className="italic">Unassigned — manage in Refurbishment module</span>}
                        </div>
                      )}
                    </div>
                    {refurbJob?.status === 'ready' && canTransfer && (
                      <ActionBtn label="Transfer to Warehouse" tone="success" onClick={() => transferToSell(refurbJob.id)} />
                    )}
                  </div>
                )
              })}
              {filteredBulkRepair.map(p => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-surface transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-text-1 truncate" title={p.name}>{p.name}</p>
                    <p className="text-[10px] text-text-3"><span className="tabular-nums font-semibold">{p.qty}</span> units in refurbishment</p>
                  </div>
                  <span className="text-[10px] text-text-4 italic">Use Transfers tab to move bulk items</span>
                </div>
              ))}
              {(filteredRepairSerials.length > 0 || filteredBulkRepair.length > 0) && (
                <div className="px-4 py-2 text-[10px] bg-[var(--info-bg)] text-[var(--info-text)] border-t border-[var(--border-lt)]">
                  <Fa icon={faWrench} /> Manage assignments, progress &amp; transfers in the <strong>Refurbishment</strong> module
                </div>
              )}
            </Section>
            </div>
          </div>
        )
      })()}

      {tab === 'product_master' && (
        <div className="overflow-hidden">
          <InventoryProductsPanel
            orphanedVariantIds={orphanedVariantIds}
            onEdit={product => openEdit(product)}
            onCreateVariant={product => openVariant(product)}
            onDownloadTemplate={downloadProductTemplate}
            onImportProducts={() => productImportRef.current?.click()}
            canImportProducts={canEditStock}
          />
        </div>
      )}

      {tab === 'product_catalog' && (() => {
        const validPriceRows = priceRows.filter(row => row.status === 'valid')
        const serviceCount = catalogProducts.filter(p => p.unit === 'service').length
        const pendingPriceUpdates = 0
        return (
          <div className="overflow-hidden">
            <input ref={priceImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePriceUpdateFile(f); e.currentTarget.value = '' }} />
            {(() => {
              const catalogColumns: ColumnDef<Product>[] = [
                {
                  key: 'product', label: 'Product', priority: 1, width: 'minmax(14rem, 2fr)',
                  render: product => (
                    <span className="min-w-0 block">
                      <span className="text-xs font-bold text-text-1 erp-truncate" title={product.name}>{product.name}</span>
                      <span className="text-[10px] text-text-3 font-mono erp-truncate" title={product.sku || product.barcode || ''}>{product.sku || product.barcode || '—'}</span>
                    </span>
                  ),
                  accessor: product => `${product.name} ${product.sku} ${product.barcode ?? ''}`,
                  exportValue: product => product.name,
                },
                {
                  key: 'category', label: 'Category', priority: 2, width: '120px',
                  render: product => <span className="text-xs text-text-3 erp-truncate" title={product.category}>{product.category}</span>,
                  exportValue: product => product.category,
                },
                {
                  key: 'available', label: 'Available', priority: 1, width: '100px', align: 'right',
                  render: product => <span className="text-xs font-bold text-primary-700 tabular-nums">{product.unit === 'service' ? 'Service' : getAvailableQty(product)}</span>,
                  exportValue: product => product.unit === 'service' ? 'Service' : getAvailableQty(product),
                },
                {
                  key: 'cost', label: 'Cost', priority: 2, width: '110px', align: 'right',
                  render: product => <span className="text-xs font-mono text-text-3 tabular-nums">{fmtKes(product.costPrice)}</span>,
                  exportValue: product => product.costPrice,
                },
                {
                  key: 'salePrice', label: 'Sale price', priority: 1, width: '110px', align: 'right',
                  render: product => <span className="text-xs font-mono font-extrabold text-emerald-700 tabular-nums">{fmtKes(product.salePrice)}</span>,
                  exportValue: product => product.salePrice,
                },
                {
                  key: 'margin', label: 'GP %', priority: 2, width: '100px', align: 'right',
                  render: product => {
                    const markup = getCategoryMarkupPct(systemSettings.invCategorySaleMarkupPct, product.category)
                    const profit = product.salePrice > 0
                      ? Math.round(((product.salePrice - product.costPrice) / product.salePrice) * 1000) / 10
                      : null
                    if (markup !== null) {
                      return (
                        <span
                          className="text-xs font-bold tabular-nums text-emerald-700"
                          title={profit !== null ? `Profit margin ${profit}%` : 'Category markup from Sales settings'}
                        >
                          {markup}%
                        </span>
                      )
                    }
                    return (
                      <span className={`text-xs font-bold tabular-nums ${
                        profit === null ? 'text-text-3'
                          : profit < 0 ? 'text-red-600'
                            : profit < 15 ? 'text-amber-600'
                              : 'text-emerald-600'
                      }`}>
                        {profit === null ? '—' : `${profit}%`}
                      </span>
                    )
                  },
                  exportValue: product => {
                    const markup = getCategoryMarkupPct(systemSettings.invCategorySaleMarkupPct, product.category)
                    if (markup !== null) return markup
                    return product.salePrice > 0
                      ? Math.round(((product.salePrice - product.costPrice) / product.salePrice) * 1000) / 10
                      : ''
                  },
                },
                {
                  key: 'lastUpdate', label: 'Last update', priority: 3, width: '140px',
                  render: product => {
                    const latest = (priceHistoryByProduct.get(product.id) ?? [])[0]
                    const label = latest ? `${fmtDate(latest.effectiveDate)} · ${latest.updatedByName}` : '—'
                    return <span className="text-[10px] text-text-3 erp-truncate" title={label}>{label}</span>
                  },
                  exportValue: product => {
                    const latest = (priceHistoryByProduct.get(product.id) ?? [])[0]
                    return latest ? `${latest.effectiveDate} ${latest.updatedByName}` : ''
                  },
                },
              ]
              const inStockCount = catalogProducts.filter(p => p.unit === 'service' || getAvailableQty(p) > 0).length
              const outOfStockCount = catalogProducts.filter(p => p.unit !== 'service' && getAvailableQty(p) <= 0).length
              const catalogPrimaryFilters: PrimaryFilterConfig[] = [
                {
                  key: 'category',
                  label: 'Category',
                  placeholder: 'All categories',
                  value: catalogCatFilter,
                  allValue: 'All',
                  options: [
                    { value: 'All', label: 'All categories' },
                    ...ALL_CATEGORIES.map(c => ({ value: c, label: c })),
                  ],
                  onChange: setCatalogCatFilter,
                },
                {
                  key: 'stock',
                  label: 'Stock',
                  placeholder: 'All stock levels',
                  value: catalogStockFilter,
                  allValue: 'all',
                  options: [
                    { value: 'all', label: 'All products' },
                    { value: 'in_stock', label: 'In stock only' },
                    { value: 'out_of_stock', label: 'Out of stock only' },
                  ],
                  onChange: value => setCatalogStockFilter(value as 'all' | 'in_stock' | 'out_of_stock'),
                },
              ]
              return (
                <TablePageLayout
                  title="Product catalog"
                  summary={
                    <OperationalSummary
                      items={[
                        {
                          id: 'catalog',
                          label: 'catalog items',
                          value: catalogProducts.length,
                          onClick: () => { setCatalogStockFilter('all'); setCatalogCatFilter('All') },
                        },
                        {
                          id: 'in-stock',
                          label: 'in stock / service',
                          value: inStockCount,
                          tone: 'success',
                          onClick: () => setCatalogStockFilter('in_stock'),
                        },
                        {
                          id: 'out-stock',
                          label: 'out of stock',
                          value: outOfStockCount,
                          tone: outOfStockCount > 0 ? 'danger' : 'default',
                          onClick: () => setCatalogStockFilter('out_of_stock'),
                        },
                        { id: 'services', label: 'services', value: serviceCount },
                        {
                          id: 'pending',
                          label: 'pending price updates',
                          value: pendingPriceUpdates,
                          tone: pendingPriceUpdates > 0 ? 'warning' : 'default',
                        },
                      ]}
                    />
                  }
                  notice={
                    <CompactInfoNotice dismissible storageKey="inventory-catalog-price-notice">
                      Catalog export includes every active sellable product (including zero stock). Use the Stock filter for in-stock only.
                      Price changes apply only to future sales. Historical invoices and POS receipts remain unchanged.
                      {!canUpdatePrice ? ' Price editing is read-only for your role.' : ''}
                    </CompactInfoNotice>
                  }
                >
                  <DataTable
                    tableId="inventory-catalog"
                    columns={catalogColumns}
                    rows={catalogProducts}
                    rowKey={p => p.id}
                    searchValue={catalogSearch}
                    onSearchChange={setCatalogSearch}
                    searchPlaceholder="Search product, SKU or barcode…"
                    clientSearch={false}
                    primaryFilters={catalogPrimaryFilters}
                    onClearFilters={() => { setCatalogSearch(''); setCatalogCatFilter('All'); setCatalogStockFilter('all') }}
                    hideColumnFilters
                    emptyMessage={
                      catalogSearch || catalogCatFilter !== 'All' || catalogStockFilter !== 'all'
                        ? 'No catalog products match these filters'
                        : 'No catalog products yet'
                    }
                    emptyAction={
                      canEditStock && !catalogSearch && catalogCatFilter === 'All' && catalogStockFilter === 'all' ? (
                        <PrimaryActionButton onClick={openNew}>New product</PrimaryActionButton>
                      ) : undefined
                    }
                    exportTitle="Product Catalog"
                    exportFilename="inventory-catalog"
                    perPage={20}
                    overflowActions={[
                      { id: 'product-template', label: 'Download product template', onSelect: downloadProductTemplate },
                      { id: 'product-import', label: 'Import products (bulk)', onSelect: () => productImportRef.current?.click(), disabled: !canEditStock },
                      { id: 'price-template', label: 'Download price template', onSelect: downloadPriceUpdateTemplate },
                      { id: 'price-import', label: 'Import prices', onSelect: () => priceImportRef.current?.click(), disabled: !canUpdatePrice },
                    ]}
                    rowActions={product => (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn-primary text-[10px] py-1 px-2"
                          onClick={() => openPriceUpdate(product)}
                          disabled={!canUpdatePrice}
                          title={canUpdatePrice ? 'Edit price' : 'Price update not permitted'}
                        >
                          Edit price
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-[10px] py-1 px-2"
                          aria-label={`Price history for ${product.name}`}
                          title="Price history"
                          onClick={() => setHistoryProduct(product)}
                        >
                          History
                        </button>
                      </div>
                    )}
                  />
                </TablePageLayout>
              )
            })()}

            {priceProduct && (
              <Modal title="Update Sale Price" subtitle={priceProduct.name} onClose={() => setPriceProduct(null)} width={520}>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-surface border border-border-lt rounded-xl">
                      <p className="text-[10px] uppercase font-bold text-text-3">Current Sale Price</p>
                      <p className="text-sm font-extrabold text-text-1 mt-1">{fmtKes(priceProduct.salePrice)}</p>
                    </div>
                    <div className="p-3 bg-surface border border-border-lt rounded-xl">
                      <p className="text-[10px] uppercase font-bold text-text-3">Cost (read-only)</p>
                      <p className="text-sm font-extrabold text-text-1 mt-1">{fmtKes(priceProduct.costPrice)}</p>
                    </div>
                  </div>
                  <Field label="New Sale Price" required>
                    <Input type="number" value={priceForm.salePrice} onChange={v => setPriceForm(f => ({ ...f, salePrice: v }))} placeholder="0" />
                  </Field>
                  {(() => {
                    const quote = quoteSalePriceFromCost({
                      costPrice: priceProduct.costPrice,
                      erpCategory: priceProduct.category,
                      pricingCategoryId: (priceProduct as any).pricingCategoryId,
                      policy: systemSettings.pricingMarginPolicy,
                      legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
                    })
                    if (quote.ok) {
                      return (
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--info-bg)] px-3 py-2 space-y-2">
                          <p className="text-[11px] text-[var(--navy)] m-0 leading-relaxed">
                            <strong>{quote.category.name}</strong> band after {quote.overheadRatePct.toFixed(1)}% overhead
                            {quote.tierReductionPct ? ` and ${quote.tierReductionPct}% tier cut` : ''}:
                            {' '}min {fmtKes(quote.min.sellExVatRounded)} – max {fmtKes(quote.max.sellExVatRounded)} ex VAT.
                            List defaults to max.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn-secondary text-[11px] px-2.5 py-1"
                              onClick={() => setPriceForm(f => ({ ...f, salePrice: String(quote.min.sellExVatRounded) }))}>Use min</button>
                            <button type="button" className="btn-secondary text-[11px] px-2.5 py-1"
                              onClick={() => setPriceForm(f => ({ ...f, salePrice: String(quote.max.sellExVatRounded) }))}>Use max</button>
                          </div>
                        </div>
                      )
                    }
                    if ('legacySale' in quote && quote.legacySale != null) {
                      return (
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--info-bg)] px-3 py-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] text-[var(--navy)] m-0">Legacy markup → {fmtKes(quote.legacySale)}</p>
                          <button type="button" className="btn-secondary text-[11px] px-2.5 py-1"
                            onClick={() => setPriceForm(f => ({ ...f, salePrice: String(quote.legacySale) }))}>Use markup</button>
                        </div>
                      )
                    }
                    return null
                  })()}
                  <Field label="Reason" required>
                    <Input value={priceForm.reason} onChange={v => setPriceForm(f => ({ ...f, reason: v }))} placeholder="e.g. Supplier price change, promo, clearance" />
                  </Field>
                  <Field label="Effective Date">
                    <Input type="date" value={priceForm.effectiveDate} onChange={v => setPriceForm(f => ({ ...f, effectiveDate: v }))} />
                  </Field>
                  {Number(priceForm.salePrice) < Number(priceProduct.costPrice) && Number(priceProduct.costPrice) > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-[11px] text-amber-800">
                      New sale price is below cost. Confirm this is intentional in the reason.
                    </div>
                  )}
                  <div className="flex justify-end gap-3">
                    <button className="btn-secondary px-6" onClick={() => setPriceProduct(null)}>Cancel</button>
                    <button className="btn-primary px-8" onClick={submitPriceUpdate}>Save Sale Price</button>
                  </div>
                </div>
              </Modal>
            )}

            {historyProduct && (
              <Modal title="Price History" subtitle={historyProduct.name} onClose={() => setHistoryProduct(null)} width={680}>
                <DataTable
                  tableId="inventory-price-history"
                  columns={[
                    {
                      key: 'date', label: 'Date', priority: 1, width: '100px',
                      render: entry => <span className="text-xs text-text-3">{fmtDate(entry.effectiveDate)}</span>,
                      exportValue: entry => entry.effectiveDate,
                    },
                    {
                      key: 'sale', label: 'Old → new', priority: 1, width: '110px', align: 'right',
                      render: entry => <span className="text-[10px] font-mono">{fmtKes(entry.oldSalePrice)} → {fmtKes(entry.newSalePrice)}</span>,
                      exportValue: entry => `${entry.oldSalePrice} → ${entry.newSalePrice}`,
                    },
                    {
                      key: 'cost', label: 'Cost', priority: 2, width: '110px', align: 'right',
                      render: entry => <span className="text-[10px] font-mono">{fmtKes(entry.oldCostPrice)} → {fmtKes(entry.newCostPrice)}</span>,
                      exportValue: entry => `${entry.oldCostPrice} → ${entry.newCostPrice}`,
                    },
                    {
                      key: 'reason', label: 'Reason', priority: 1, width: '1fr',
                      render: entry => <span className="text-xs text-text-2 truncate" title={entry.reason}>{entry.reason}</span>,
                      exportValue: entry => entry.reason,
                    },
                    {
                      key: 'updatedBy', label: 'Updated by', priority: 2, width: '130px',
                      render: entry => <span className="text-xs text-text-3">{entry.updatedByName}</span>,
                      exportValue: entry => entry.updatedByName,
                    },
                  ] as ColumnDef<(typeof productPriceHistory)[number]>[]}
                  rows={priceHistoryByProduct.get(historyProduct.id) ?? []}
                  rowKey={entry => entry.id}
                  hideSearch
                  emptyMessage="No price changes recorded for this product."
                  perPage={20}
                />
              </Modal>
            )}

            {showPriceImport && (
              <Modal title="Import Price Updates — Preview" onClose={() => { setShowPriceImport(false); setPriceRows([]) }} width={880}>
                <div>
                <div className="px-3 py-2 text-[11px] bg-sky-50 border border-sky-100 rounded-lg mb-4 text-sky-800">
                  <strong>{validPriceRows.length} valid</strong> price update{validPriceRows.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
                  <strong>{priceRows.filter(row => row.status === 'unchanged').length} unchanged</strong> &nbsp;·&nbsp;
                  <strong>{priceRows.filter(row => row.status === 'invalid').length} invalid</strong>
                </div>
                <DataTable
                  tableId="inventory-price-import"
                  columns={[
                    {
                      key: 'status', label: 'Status', priority: 1, width: '110px',
                      render: row => (
                        <>
                          {row.status === 'valid' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">Valid</span>}
                          {row.status === 'unchanged' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">Unchanged</span>}
                          {row.status === 'invalid' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700">Invalid</span>}
                        </>
                      ),
                      exportValue: row => row.status,
                    },
                    {
                      key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                      render: row => {
                        const label = row.productName || row.sku || '—'
                        return <span className="text-xs text-text-1 font-medium truncate" title={label}>{label}</span>
                      },
                      exportValue: row => row.productName || row.sku || '',
                    },
                    {
                      key: 'current', label: 'Current', priority: 2, width: '110px', align: 'right',
                      render: row => <span className="text-xs font-mono text-text-3">{fmtKes(row.currentSalePrice)}</span>,
                      exportValue: row => row.currentSalePrice,
                    },
                    {
                      key: 'new', label: 'New', priority: 1, width: '110px', align: 'right',
                      render: row => <span className="text-xs font-mono font-bold text-emerald-700">{Number.isFinite(row.newSalePrice) ? fmtKes(row.newSalePrice) : '—'}</span>,
                      exportValue: row => Number.isFinite(row.newSalePrice) ? row.newSalePrice : '',
                    },
                    {
                      key: 'effective', label: 'Effective', priority: 2, width: '110px',
                      render: row => <span className="text-xs text-text-3">{row.effectiveDate}</span>,
                      exportValue: row => row.effectiveDate,
                    },
                    {
                      key: 'reason', label: 'Reason / issue', priority: 2, width: '1.5fr',
                      render: row => <span className="text-[10px] text-text-3 truncate" title={row.reasonText || row.reason}>{row.reasonText || row.reason}</span>,
                      exportValue: row => row.reasonText || row.reason,
                    },
                  ] as ColumnDef<PriceUpdateRow & { _key: string }>[]}
                  rows={priceRows.map((row, i) => ({ ...row, _key: `${row.productId || row.sku || 'row'}-${i}` }))}
                  rowKey={row => row._key}
                  hideSearch
                  emptyMessage="No price rows to preview"
                  rowClassName={row => row.status !== 'valid' ? 'opacity-70' : ''}
                  perPage={50}
                />
                <div className="flex gap-3 justify-end mt-4">
                  <button className="btn-secondary px-6" onClick={() => { setShowPriceImport(false); setPriceRows([]) }}>Cancel</button>
                  <button className="btn-primary px-8" onClick={confirmPriceImport} disabled={!canUpdatePrice || validPriceRows.length === 0}>
                    Apply {validPriceRows.length} Update{validPriceRows.length !== 1 ? 's' : ''}
                  </button>
                </div>
                </div>
              </Modal>
            )}
          </div>
        )
      })()}




      {tab === 'opening_stock' && (
        <div className="flex flex-col gap-4">
          <div className="card overflow-hidden">
            <PanelHeader title="Opening Stock Setup" count={openingStockRows.length}>
              <button
                className="btn-primary text-[11px] sm:text-xs py-1.5 w-full sm:w-auto justify-center"
                onClick={openOpeningStockModal}
                disabled={openingStockPosted}
              >
                {openingStockPosted ? 'Opening Stock Locked' : '+ Post Opening Stock'}
              </button>
            </PanelHeader>
            <div className={`px-4 py-3 text-[11px] border-b ${openingStockPosted ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>
              <p className="font-bold text-xs mb-1">One-time initial stock entry</p>
              <p>
                Use this screen only when setting up the app for the first time. It posts the starting quantities and serial numbers into inventory, writes stock movement records, and then locks the opening-stock workflow so normal stock changes must come from purchases, sales, transfers, or repairs.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-surface/40 border-b border-border-lt">
              <div className="card p-3 bg-white border-border-lt">
                <p className="text-[10px] uppercase font-bold text-text-3">Status</p>
                <p className={`text-sm font-extrabold mt-1 ${openingStockPosted ? 'text-emerald-700' : 'text-amber-700'}`}>{openingStockPosted ? 'Posted & Locked' : 'Ready for first posting'}</p>
              </div>
              <div className="card p-3 bg-white border-border-lt">
                <p className="text-[10px] uppercase font-bold text-text-3">Stockable Products</p>
                <p className="text-sm font-extrabold text-primary-700 mt-1">{stockableProducts.length}</p>
              </div>
              <div className="card p-3 bg-white border-border-lt">
                <p className="text-[10px] uppercase font-bold text-text-3">Opening Lines Posted</p>
                <p className="text-sm font-extrabold text-primary-700 mt-1">{openingStockRows.length}</p>
              </div>
            </div>
            {!openingStockPosted && stockableProducts.length === 0 && (
              <div className="px-4 py-4 bg-red-50 border-b border-red-100 text-red-700 text-[11px]">
                No stockable products exist yet. Create products in Product Master first, then return here to post opening stock.
              </div>
            )}
            <DataTable
              tableId="inventory-opening-stock"
              columns={[
                {
                  key: 'date', label: 'Date', priority: 1, width: '100px',
                  render: move => <span className="text-xs text-text-3">{fmtDate(move.date)}</span>,
                  exportValue: move => move.date,
                },
                {
                  key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                  render: move => <span className="text-xs text-text-1 font-medium truncate" title={move.productName}>{move.productName}</span>,
                  exportValue: move => move.productName,
                },
                {
                  key: 'sku', label: 'SKU', priority: 2, width: '120px',
                  render: move => <span className="font-mono text-[10px] text-text-3">{move.product?.sku ?? '—'}</span>,
                  exportValue: move => move.product?.sku ?? '',
                },
                {
                  key: 'qty', label: 'Qty', priority: 1, width: '90px', align: 'right',
                  render: move => <span className="text-xs font-bold text-primary-700">{move.qty}</span>,
                  exportValue: move => move.qty,
                },
                {
                  key: 'location', label: 'Location', priority: 2, width: '120px',
                  render: move => <span className="text-xs text-text-3">{LOCATIONS[move.location].icon} {LOCATIONS[move.location].name}</span>,
                  exportValue: move => LOCATIONS[move.location].name,
                },
                {
                  key: 'serials', label: 'Serials', priority: 3, width: '120px',
                  render: move => <span className="text-xs text-text-3 truncate">{move.product?.requiresSerial ? `${move.qty} serialized unit${move.qty === 1 ? '' : 's'}` : 'Bulk stock'}</span>,
                  exportValue: move => move.product?.requiresSerial ? `${move.qty} serialized` : 'Bulk stock',
                },
                {
                  key: 'document', label: 'Document', priority: 2, width: '120px',
                  render: move => <Badge status="active" label={move.documentRef} />,
                  exportValue: move => move.documentRef,
                },
              ]}
              rows={[...openingStockRows].reverse()}
              rowKey={move => move.id}
              emptyMessage="No opening stock has been posted yet"
              emptyAction={!openingStockPosted ? (
                <button className="btn-primary px-6" onClick={openOpeningStockModal} disabled={stockableProducts.length === 0}>Post Opening Stock</button>
              ) : undefined}
              exportTitle="Opening Stock"
              exportFilename="inventory-opening-stock"
              searchPlaceholder="Search opening stock…"
              perPage={20}
            />
          </div>
        </div>
      )}

      {tab === 'stock_in' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Stock In - Purchase Receipts Only" count={validatedReceipts.length} />
          <div className="px-4 py-2.5 text-[10px] sm:text-[11px] bg-amber-50/50 border-b border-amber-100 text-amber-800">
            Stock can only increase through Purchase → GRN → Inventory. No manual stock-in exists in Inventory.
            {pendingReceipts.length > 0 && canValidatePurchaseReceipt(currentUser?.role) && (
              <span className="block mt-1 font-bold">
                {pendingReceipts.length} draft receipt(s) await validation in Purchase. Open Purchase → Receive to validate.
              </span>
            )}
          </div>
          <DataTable
            tableId="inventory-stock-in"
            columns={[
              {
                key: 'ref', label: 'GRN ref', priority: 1, width: '120px',
                render: receipt => <span className="font-mono text-[11px] font-bold text-primary-700">{receipt.ref}</span>,
                exportValue: receipt => receipt.ref,
              },
              {
                key: 'poRef', label: 'PO ref', priority: 2, width: '120px',
                render: receipt => <span className="font-mono text-xs text-text-3">{receipt.poRef}</span>,
                exportValue: receipt => receipt.poRef,
              },
              {
                key: 'vendor', label: 'Vendor', priority: 1, width: '1.5fr',
                render: receipt => <span className="text-xs text-text-1 font-medium">{receipt.vendorName}</span>,
                exportValue: receipt => receipt.vendorName,
              },
              {
                key: 'date', label: 'Date', priority: 2, width: '100px',
                render: receipt => <span className="text-xs text-text-3">{fmtDate(receipt.date)}</span>,
                exportValue: receipt => receipt.date,
              },
              {
                key: 'location', label: 'Location', priority: 2, width: '120px',
                render: receipt => <span className="text-xs text-text-3">{LOCATIONS[receipt.destinationLocation].icon} {LOCATIONS[receipt.destinationLocation].name}</span>,
                exportValue: receipt => LOCATIONS[receipt.destinationLocation].name,
              },
              {
                key: 'status', label: 'Status', priority: 1, width: '100px',
                render: () => <Badge status="active" label="Validated" />,
                exportValue: () => 'Validated',
              },
              {
                key: 'result', label: 'Result', priority: 3, width: '120px',
                render: () => <span className="text-[10px] font-bold text-emerald-600">Stock added</span>,
                exportValue: () => 'Stock added',
              },
            ]}
            rows={validatedReceipts}
            rowKey={r => r.id}
            emptyMessage="No validated GRNs yet"
            exportTitle="Stock In Receipts"
            exportFilename="inventory-stock-in"
            searchPlaceholder="Search receipts…"
            perPage={20}
          />
          {pendingReceipts.length > 0 && (
            <div className="px-4 py-3 text-[10px] text-amber-700 bg-amber-50/30 border-t border-amber-100">
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
              <div key={card.title} className="card p-4 bg-surface border-border-lt">
                <div className="text-text-1 font-bold text-xs mb-1">{card.title}</div>
                <div className="text-text-3 text-[11px] leading-relaxed">{card.text}</div>
              </div>
            ))}
          </div>
          <DataTable
            tableId="inventory-stock-out"
            columns={[
              {
                key: 'date', label: 'Date', priority: 1, width: '100px',
                render: move => <span className="text-xs text-text-3">{fmtDate(move.date)}</span>,
                exportValue: move => move.date,
              },
              {
                key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                render: move => <span className="text-xs text-text-1 font-medium">{move.productName}</span>,
                exportValue: move => move.productName,
              },
              {
                key: 'type', label: 'Type', priority: 1, width: '100px',
                render: move => <Badge status={move.type === 'out' ? 'cancelled' : 'pending'} label={move.type === 'out' ? 'Sale / Usage' : 'Return'} />,
                exportValue: move => move.type === 'out' ? 'Sale / Usage' : 'Return',
              },
              {
                key: 'qty', label: 'Qty', priority: 1, width: '80px',
                render: move => <span className="text-xs font-bold text-red-600">{move.qty}</span>,
                exportValue: move => move.qty,
              },
              {
                key: 'from', label: 'From', priority: 2, width: '120px',
                render: move => <span className="text-xs text-text-3">{move.fromLocation ? LOCATIONS[move.fromLocation].name : '—'}</span>,
                exportValue: move => move.fromLocation ? LOCATIONS[move.fromLocation].name : '',
              },
              {
                key: 'to', label: 'To', priority: 2, width: '120px',
                render: move => <span className="text-xs text-text-3">{move.toLocation ? LOCATIONS[move.toLocation].name : '—'}</span>,
                exportValue: move => move.toLocation ? LOCATIONS[move.toLocation].name : '',
              },
              {
                key: 'document', label: 'Document', priority: 2, width: '120px',
                render: move => <span className="font-mono text-[11px] font-bold text-primary-700">{move.documentRef}</span>,
                exportValue: move => move.documentRef,
              },
            ]}
            rows={stockOutMoves}
            rowKey={m => m.id}
            emptyMessage="No stock out movements recorded"
            exportTitle="Stock Out"
            exportFilename="inventory-stock-out"
            searchPlaceholder="Search stock out…"
            perPage={20}
          />
        </div>
      )}

      {tab === 'transfers' && (
        <div className="card overflow-hidden">
          <PanelHeader title="Internal Transfers" count={stockTransfers.length}>
            <button className="btn-primary text-[11px] sm:text-xs py-1.5 w-full sm:w-auto justify-center" onClick={() => setShowTransfer(true)}>+ New Transfer</button>
          </PanelHeader>
          <DataTable
            tableId="inventory-transfers"
            columns={[
              {
                key: 'ref', label: 'Ref', priority: 1, width: '120px',
                render: transfer => <span className="font-mono text-[11px] font-bold text-primary-700">{transfer.ref}</span>,
                exportValue: transfer => transfer.ref,
              },
              {
                key: 'from', label: 'From', priority: 1, width: '120px',
                render: transfer => <span className="text-xs text-text-3">{LOCATIONS[transfer.fromLocation].icon} {LOCATIONS[transfer.fromLocation].name}</span>,
                exportValue: transfer => LOCATIONS[transfer.fromLocation].name,
              },
              {
                key: 'to', label: 'To', priority: 1, width: '120px',
                render: transfer => <span className="text-xs text-text-3">{LOCATIONS[transfer.toLocation].icon} {LOCATIONS[transfer.toLocation].name}</span>,
                exportValue: transfer => LOCATIONS[transfer.toLocation].name,
              },
              {
                key: 'items', label: 'Items', priority: 2, width: '1.5fr',
                render: transfer => {
                  const label = transfer.lines.map(line => `${line.productName} ×${line.qty}`).join(', ')
                  return <span className="text-xs text-text-1 font-medium truncate" title={label}>{label}</span>
                },
                exportValue: transfer => transfer.lines.map(line => `${line.productName} x${line.qty}`).join(', '),
              },
              {
                key: 'date', label: 'Date', priority: 2, width: '100px',
                render: transfer => <span className="text-xs text-text-3">{fmtDate(transfer.date)}</span>,
                exportValue: transfer => transfer.date,
              },
              {
                key: 'status', label: 'Status', priority: 1, width: '100px',
                render: transfer => <Badge status={transfer.status === 'done' ? 'done' : 'pending'} label={transfer.status} />,
                exportValue: transfer => transfer.status,
              },
            ]}
            rows={[...stockTransfers].reverse()}
            rowKey={t => t.id}
            emptyMessage="No transfers recorded"
            exportTitle="Internal Transfers"
            exportFilename="inventory-transfers"
            searchPlaceholder="Search transfers…"
            perPage={20}
          />
        </div>
      )}

      {tab === 'adjustments' && (() => {
        const ADJ_REASONS: Record<AdjReason, string> = {
          damage: 'Damage / Write-off',
          theft: 'Theft / Loss',
          count_correction: 'Stock Count Correction',
          expiry: 'Expiry',
          other: 'Other',
        }
        const filtered = stockAdjustments.filter(a => adjFilter === 'all' || a.status === adjFilter)
        const pendingCount   = stockAdjustments.filter(a => a.status === 'pending').length
        const approvedCount  = stockAdjustments.filter(a => a.status === 'approved').length
        const rejectedCount  = stockAdjustments.filter(a => a.status === 'rejected').length

        const submitAdj = () => {
          const qty = Number(adjForm.qty)
          if (!adjForm.productId) { showToast('Select a product', 'error'); return }
          if (!qty || qty <= 0)   { showToast('Enter a valid quantity', 'error'); return }
          createAdjustment(adjForm.productId, adjForm.productName, adjForm.type, qty, adjForm.reason, adjForm.notes)
          setAdjForm({ productId: '', productName: '', type: 'subtract', qty: '', reason: 'count_correction', notes: '' })
          setShowAdjForm(false)
        }

        const selectedAdjProduct = stockableProducts.find(p => p.id === adjForm.productId)
        const adjProductStock = selectedAdjProduct
          ? (() => { const l = getStockByLocation(selectedAdjProduct.id); return (l.warehouse ?? 0) + (l.shop ?? 0) + (l.repair_unit ?? 0) })()
          : null

        return (
          <div className="flex flex-col gap-4">
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card p-3 flex flex-col gap-1">
                <p className="text-[10px] uppercase font-bold text-text-3">Total</p>
                <p className="text-xl font-extrabold text-text-1">{stockAdjustments.length}</p>
              </div>
              <div className="card p-3 flex flex-col gap-1 bg-amber-50/70">
                <p className="text-[10px] uppercase font-bold text-amber-900">Pending Approval</p>
                <p className="text-xl font-extrabold text-amber-900">{pendingCount}</p>
              </div>
              <div className="card p-3 flex flex-col gap-1 bg-emerald-50/70">
                <p className="text-[10px] uppercase font-bold text-emerald-900">Approved</p>
                <p className="text-xl font-extrabold text-emerald-900">{approvedCount}</p>
              </div>
              <div className="card p-3 flex flex-col gap-1 bg-red-50/70">
                <p className="text-[10px] uppercase font-bold text-red-900">Rejected</p>
                <p className="text-xl font-extrabold text-red-900">{rejectedCount}</p>
              </div>
            </div>

            <div className="card overflow-hidden">
              <PanelHeader title="Stock Adjustments" count={filtered.length}>
                <div className="flex gap-2 items-center flex-wrap">
                  {/* Status filter */}
                  <div className="flex rounded-lg border border-border-lt overflow-hidden text-[11px]">
                    {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                      <button key={f} onClick={() => setAdjFilter(f)}
                        className={`px-3 py-1.5 font-semibold capitalize transition-colors ${adjFilter === f ? 'bg-primary-600 text-white' : 'bg-white text-text-3 hover:bg-surface'}`}>
                        {f === 'all' ? 'All' : f}
                        {f === 'pending' && pendingCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold">{pendingCount}</span>}
                      </button>
                    ))}
                  </div>
                  {canRequestAdj && (
                    <button className="btn-primary text-[11px] py-1.5 px-3" onClick={() => setShowAdjForm(true)}>+ Request Adjustment</button>
                  )}
                </div>
              </PanelHeader>

              {/* Approver notice */}
              {canApproveAdj && pendingCount > 0 && (
                <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800 font-medium flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  {pendingCount} adjustment{pendingCount > 1 ? 's' : ''} awaiting your approval
                </div>
              )}
              {!canApproveAdj && (
                <div className="px-4 py-2.5 bg-sky-50 border-b border-sky-100 text-[11px] text-sky-700">
                  Adjustments you request go to an inventory approver before stock is updated.
                </div>
              )}

              <DataTable
                tableId="inventory-adjustments"
                columns={[
                  {
                    key: 'ref', label: 'Ref', priority: 1, width: '110px',
                    render: adj => <span className="font-mono text-[11px] font-bold text-primary-700">{adj.ref}</span>,
                    exportValue: adj => adj.ref,
                  },
                  {
                    key: 'date', label: 'Date', priority: 2, width: '100px',
                    render: adj => <span className="text-xs text-text-3">{fmtDate(adj.date)}</span>,
                    exportValue: adj => adj.date,
                  },
                  {
                    key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                    render: adj => <span className="text-xs text-text-1 font-medium truncate" title={adj.productName}>{adj.productName}</span>,
                    exportValue: adj => adj.productName,
                  },
                  {
                    key: 'type', label: 'Type', priority: 1, width: '90px',
                    render: adj => (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${adj.type === 'add' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                        {adj.type === 'add' ? '▲ Add' : '▼ Remove'}
                      </span>
                    ),
                    exportValue: adj => adj.type === 'add' ? 'Add' : 'Remove',
                  },
                  {
                    key: 'qty', label: 'Qty', priority: 1, width: '70px', align: 'right',
                    render: adj => (
                      <span className={`text-xs font-extrabold ${adj.type === 'add' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {adj.type === 'add' ? '+' : '-'}{adj.qty}
                      </span>
                    ),
                    exportValue: adj => adj.type === 'add' ? adj.qty : -adj.qty,
                  },
                  {
                    key: 'reason', label: 'Reason', priority: 2, width: '130px',
                    render: adj => <span className="text-xs text-text-3">{ADJ_REASONS[adj.reason]}</span>,
                    exportValue: adj => ADJ_REASONS[adj.reason],
                  },
                  {
                    key: 'requestedBy', label: 'Requested by', priority: 3, width: '120px',
                    render: adj => <span className="text-xs text-text-3 truncate">{adj.requestedBy}</span>,
                    exportValue: adj => adj.requestedBy,
                  },
                  {
                    key: 'status', label: 'Status', priority: 1, width: '110px',
                    render: adj => (
                      <>
                        {adj.status === 'pending' && <Badge status="pending" label="Pending" />}
                        {adj.status === 'approved' && <Badge status="active" label="Approved" />}
                        {adj.status === 'rejected' && <Badge status="cancelled" label="Rejected" />}
                      </>
                    ),
                    exportValue: adj => adj.status,
                  },
                ]}
                rows={[...filtered].reverse()}
                rowKey={adj => adj.id}
                hideSearch
                emptyMessage={adjFilter !== 'all' ? `No ${adjFilter} adjustments.` : 'No adjustments found'}
                exportTitle="Stock Adjustments"
                exportFilename="inventory-adjustments"
                perPage={20}
                rowActions={adj => (
                  <div className="flex justify-end gap-1.5">
                    {adj.status === 'pending' && canApproveAdj && (
                      <>
                        <button onClick={() => approveAdjustment(adj.id, true)}
                          className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all">
                          Approve
                        </button>
                        <button onClick={() => approveAdjustment(adj.id, false)}
                          className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all">
                          Reject
                        </button>
                      </>
                    )}
                    {adj.status === 'approved' && adj.approvedBy && (
                      <span className="text-[10px] text-emerald-600 font-medium">✓ {adj.approvedBy}</span>
                    )}
                    {adj.status === 'rejected' && adj.approvedBy && (
                      <span className="text-[10px] text-red-500 font-medium">✗ {adj.approvedBy}</span>
                    )}
                  </div>
                )}
              />
            </div>

            {/* Request adjustment modal */}
            {showAdjForm && (
              <Modal title="Request Stock Adjustment" onClose={() => setShowAdjForm(false)} width={520}>
                <div className="flex flex-col gap-4">
                  {/* Type selector */}
                  <div>
                    <p className="text-[11px] font-bold text-text-3 uppercase mb-2">Adjustment Type</p>
                    <div className="grid grid-cols-2 gap-3">
                      {(['subtract', 'add'] as const).map(t => (
                        <button key={t} onClick={() => setAdjForm(f => ({ ...f, type: t }))}
                          className={`py-3 rounded-xl border-2 text-xs font-bold flex flex-col items-center gap-1 transition-all ${
                            adjForm.type === t
                              ? t === 'subtract' ? 'border-red-400 bg-red-50 text-red-700' : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                              : 'border-border-lt bg-surface text-text-3 hover:border-primary-300'
                          }`}>
                          <span className="text-xl">{t === 'subtract' ? '▼' : '▲'}</span>
                          <span>{t === 'subtract' ? 'Remove Stock' : 'Add Stock'}</span>
                          <span className="text-[9px] font-normal opacity-70">{t === 'subtract' ? 'Write-down, loss, damage' : 'Found stock, count correction'}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field label="Product" required>
                    <SearchPicker
                      label="" placeholder="Search product..."
                      items={stockableProducts}
                      onSelect={p => setAdjForm(f => ({ ...f, productId: p.id, productName: p.name }))}
                      renderItem={p => `${p.name} (${p.sku})`}
                    />
                  </Field>

                  {/* Current stock indicator */}
                  {selectedAdjProduct && (
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                      <span className="text-text-3">Current stock on hand:</span>
                      <span className="font-extrabold text-primary-700">{adjProductStock} units</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Quantity" required>
                      <Input type="number" value={adjForm.qty} onChange={v => setAdjForm(f => ({ ...f, qty: v }))} placeholder="0" />
                      {selectedAdjProduct && adjForm.type === 'subtract' && Number(adjForm.qty) > (adjProductStock ?? 0) && (
                        <p className="text-[10px] text-red-600 mt-1">Exceeds stock on hand ({adjProductStock})</p>
                      )}
                    </Field>
                    <Field label="Reason" required>
                      <Select
                        value={adjForm.reason}
                        onChange={v => setAdjForm(f => ({ ...f, reason: v as AdjReason }))}
                        options={[
                          { value: 'count_correction', label: 'Stock Count Correction' },
                          { value: 'damage',           label: 'Damage / Write-off' },
                          { value: 'theft',            label: 'Theft / Loss' },
                          { value: 'expiry',           label: 'Expiry' },
                          { value: 'other',            label: 'Other' },
                        ]}
                      />
                    </Field>
                  </div>

                  <Field label="Notes">
                    <Input value={adjForm.notes} onChange={v => setAdjForm(f => ({ ...f, notes: v }))} placeholder="Additional details for the approver..." />
                  </Field>

                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-[11px] text-amber-700">
                    This adjustment will be submitted for approval. Stock is not updated until an inventory approver approves it.
                  </div>

                  <div className="flex gap-3 justify-end">
                    <button className="btn-secondary px-6" onClick={() => setShowAdjForm(false)}>Cancel</button>
                    <button className="btn-primary px-8" onClick={submitAdj}
                      disabled={!adjForm.productId || !adjForm.qty || Number(adjForm.qty) <= 0}>
                      Submit for Approval
                    </button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        )
      })()}

      {tab === 'stock_take' && (() => {
        const stockableProds = products.filter(p => {
          if (!p.isActive) return false
          return isStockTracked(inferTrackingMethod({
            trackingMethod: p.trackingMethod,
            category: p.category,
            requiresSerial: p.requiresSerial,
            unit: p.unit,
          }))
        })
        const variances = stockTakeLines.filter(l => l.countedQty !== '' && Number(l.countedQty) !== l.systemQty)
        const initTake = () => {
          setStockTakeLines(stockableProds.map(p => ({ productId: p.id, productName: p.name, systemQty: p.stockQty, countedQty: '' })))
          setStockTakeStarted(true)
        }
        const submitVariances = () => {
          if (variances.length === 0) { showToast('No variances to submit', 'error'); return }
          for (const v of variances) {
            const diff = Number(v.countedQty) - v.systemQty
            createAdjustment(v.productId, v.productName, diff > 0 ? 'add' : 'subtract', Math.abs(diff), 'count_correction', `Stock take variance — system: ${v.systemQty}, counted: ${v.countedQty}`)
          }
          showToast(`${variances.length} adjustment${variances.length !== 1 ? 's' : ''} submitted for approval`, 'success')
          setStockTakeStarted(false)
          setStockTakeLines([])
        }
        const displayLines = stockTakeFilter === 'variance'
          ? stockTakeLines.filter(l => l.countedQty !== '' && Number(l.countedQty) !== l.systemQty)
          : stockTakeFilter === 'pending' ? stockTakeLines.filter(l => l.countedQty === '')
          : stockTakeLines
        return (
          <div className="card p-4 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-bold text-[var(--text-1)]">Cycle Count / Stock Take</h2>
                <p className="text-xs text-[var(--text-3)] mt-0.5">Compare physical counts against system quantities</p>
              </div>
              {!stockTakeStarted
                ? <button className="btn-primary" onClick={initTake}>Start Stock Take</button>
                : (
                  <div className="flex gap-2">
                    <button className="btn-secondary" onClick={() => { setStockTakeStarted(false); setStockTakeLines([]) }}>Discard</button>
                    <button className="btn-primary" style={{ background: 'var(--success)' }} disabled={variances.length === 0} onClick={submitVariances}>
                      Submit {variances.length > 0 ? `${variances.length} Variance${variances.length !== 1 ? 's' : ''}` : 'Variances'}
                    </button>
                  </div>
                )
              }
            </div>
            {!stockTakeStarted ? (
              <div className="py-12 text-center">
                <p className="text-[var(--text-3)] text-sm mb-2">No active stock take</p>
                <p className="text-[var(--text-4)] text-xs">Click "Start Stock Take" to begin counting {stockableProds.length} stockable products</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[11px] font-bold text-emerald-700">{stockTakeLines.filter(l => l.countedQty !== '').length}/{stockTakeLines.length} counted</span>
                    {variances.length > 0 && <span className="ml-2 text-[11px] font-bold text-amber-600">· {variances.length} variance{variances.length !== 1 ? 's' : ''}</span>}
                  </div>
                  <select aria-label="Filter stock take products" className="form-select text-xs w-36" value={stockTakeFilter} onChange={e => setStockTakeFilter(e.target.value)}>
                    <option value="all">All Products</option>
                    <option value="pending">Not Counted</option>
                    <option value="variance">Variances Only</option>
                  </select>
                </div>
                <DataTable
                  tableId="inventory-stock-take"
                  columns={[
                    {
                      key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                      render: line => <span className="font-medium text-sm">{line.productName}</span>,
                      exportValue: line => line.productName,
                    },
                    {
                      key: 'systemQty', label: 'System qty', priority: 1, width: '120px', align: 'right',
                      render: line => <span className="font-mono text-sm">{line.systemQty}</span>,
                      exportValue: line => line.systemQty,
                    },
                    {
                      key: 'countedQty', label: 'Counted qty', priority: 1, width: '140px', align: 'right',
                      render: line => (
                        <input
                          aria-label={`Counted quantity for ${line.productName}`}
                          type="number" min="0"
                          className="form-input w-24 text-center text-sm ml-auto"
                          placeholder="Count..."
                          value={line.countedQty}
                          onChange={e => setStockTakeLines(prev => prev.map(l =>
                            l.productId !== line.productId ? l : { ...l, countedQty: e.target.value }
                          ))}
                        />
                      ),
                      exportValue: line => line.countedQty === '' ? '' : Number(line.countedQty),
                    },
                    {
                      key: 'variance', label: 'Variance', priority: 1, width: '100px', align: 'right',
                      render: line => {
                        const counted = line.countedQty === '' ? null : Number(line.countedQty)
                        const variance = counted === null ? null : counted - line.systemQty
                        const hasVariance = variance !== null && variance !== 0
                        return (
                          <span className={`font-bold font-mono text-sm ${hasVariance ? (variance! > 0 ? 'text-emerald-600' : 'text-red-600') : 'text-[var(--text-4)]'}`}>
                            {variance === null ? '—' : variance > 0 ? `+${variance}` : variance}
                          </span>
                        )
                      },
                      exportValue: line => {
                        if (line.countedQty === '') return ''
                        return Number(line.countedQty) - line.systemQty
                      },
                    },
                  ]}
                  rows={displayLines}
                  rowKey={line => line.productId}
                  hideSearch
                  emptyMessage="No products match this filter"
                  rowClassName={line => {
                    const counted = line.countedQty === '' ? null : Number(line.countedQty)
                    const variance = counted === null ? null : counted - line.systemQty
                    return variance !== null && variance !== 0 ? 'bg-amber-50/60' : ''
                  }}
                  perPage={50}
                />
              </>
            )}
          </div>
        )
      })()}

      {(tab === 'reports' || tab === 'movements') && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 flex-wrap -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide">
            {([
              ['stock_on_hand', 'Stock on Hand'],
              ['opening_closing', 'Opening vs Closing'],
              ['movements', 'Stock Movements'],
              ['serial_tracking', 'Serial Tracking'],
              ['serial_lookup', 'Find Serial'],
              ['low_stock', 'Low Stock'],
              ['valuation', 'Valuation'],
            ] as [ReportTab, string][]).map(([value, label]) => (
              <button type="button" key={value} onClick={() => {
                setReportTab(value)
                if (tab === 'movements' && value !== 'movements') setActiveTab('reports')
              }}
                className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-all border ${
                  reportTab === value 
                    ? 'bg-primary-50 border-primary-200 text-primary-900 shadow-sm' 
                    : 'bg-transparent border-transparent text-text-3 hover:bg-surface hover:text-text-1'
                }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="card p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Month"><Select value={reportMonth} onChange={value => setReportMonth(value)} options={MONTH_OPTS} /></Field>
              <Field label="Category"><Select value={catFilter} onChange={value => setCatFilter(value)} options={[{ value: 'All', label: 'All categories' }, ...ALL_CATEGORIES.map(c => ({ value: c, label: c }))]} /></Field>
              <Field label="Product"><Select value={reportProductId} onChange={value => setReportProductId(value)} options={[{ value: 'All', label: 'All products' }, ...stockableProducts.map(p => ({ value: p.id, label: p.name }))]} /></Field>
            </div>
          </div>

          {reportTab === 'stock_on_hand' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Stock on Hand" count={reportFilteredProducts.length} />
              <DataTable
                tableId="inventory-report-stock-on-hand"
                columns={[
                  {
                    key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                    render: product => <span className="text-xs text-text-1 font-medium">{product.name}</span>,
                    exportValue: product => product.name,
                  },
                  {
                    key: 'category', label: 'Category', priority: 2, width: '1fr',
                    render: product => <span className="text-xs text-text-3">{product.category}</span>,
                    exportValue: product => product.category,
                  },
                  {
                    key: 'warehouse', label: 'Warehouse', priority: 1, width: '100px', align: 'center',
                    render: product => <span className="text-xs text-text-1">{(reportStats.get(product.id)?.locs ?? { warehouse: 0 }).warehouse}</span>,
                    exportValue: product => (reportStats.get(product.id)?.locs ?? { warehouse: 0 }).warehouse,
                  },
                  {
                    key: 'shop', label: 'Shop', priority: 2, width: '100px', align: 'center',
                    render: product => <span className="text-xs text-text-1">{(reportStats.get(product.id)?.locs ?? { shop: 0 }).shop}</span>,
                    exportValue: product => (reportStats.get(product.id)?.locs ?? { shop: 0 }).shop,
                  },
                  {
                    key: 'repair', label: 'Repair unit', priority: 2, width: '100px', align: 'center',
                    render: product => <span className="text-xs text-text-1">{(reportStats.get(product.id)?.locs ?? { repair_unit: 0 }).repair_unit}</span>,
                    exportValue: product => (reportStats.get(product.id)?.locs ?? { repair_unit: 0 }).repair_unit,
                  },
                  {
                    key: 'total', label: 'Total', priority: 1, width: '80px', align: 'center',
                    render: product => {
                      const locs = reportStats.get(product.id)?.locs ?? { warehouse: 0, shop: 0, repair_unit: 0 }
                      return <span className="text-xs font-bold text-primary-700">{locs.warehouse + locs.shop + locs.repair_unit}</span>
                    },
                    exportValue: product => {
                      const locs = reportStats.get(product.id)?.locs ?? { warehouse: 0, shop: 0, repair_unit: 0 }
                      return locs.warehouse + locs.shop + locs.repair_unit
                    },
                  },
                  {
                    key: 'status', label: 'Status', priority: 1, width: '120px',
                    render: product => {
                      const locs = reportStats.get(product.id)?.locs ?? { warehouse: 0, shop: 0, repair_unit: 0 }
                      const total = locs.warehouse + locs.shop + locs.repair_unit
                      const isLow = total <= product.minStock && product.minStock > 0
                      return <Badge status={total === 0 ? 'cancelled' : isLow ? 'pending' : 'active'} label={total === 0 ? 'Out of Stock' : isLow ? 'Low Stock' : 'Available'} />
                    },
                    exportValue: product => {
                      const locs = reportStats.get(product.id)?.locs ?? { warehouse: 0, shop: 0, repair_unit: 0 }
                      const total = locs.warehouse + locs.shop + locs.repair_unit
                      if (total === 0) return 'Out of Stock'
                      if (total <= product.minStock && product.minStock > 0) return 'Low Stock'
                      return 'Available'
                    },
                  },
                ]}
                rows={reportFilteredProducts}
                rowKey={p => p.id}
                hideSearch
                emptyMessage="No products match these filters"
                exportTitle="Stock on Hand"
                exportFilename="inventory-stock-on-hand"
                perPage={20}
              />
            </div>
          )}

          {reportTab === 'opening_closing' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Opening vs Closing Stock" count={reportFilteredProducts.length} />
              <DataTable
                tableId="inventory-report-opening-closing"
                columns={[
                  {
                    key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                    render: product => <span className="text-xs text-text-1 font-medium">{product.name}</span>,
                    exportValue: product => product.name,
                  },
                  {
                    key: 'category', label: 'Category', priority: 2, width: '100px',
                    render: product => <span className="text-xs text-text-3">{product.category}</span>,
                    exportValue: product => product.category,
                  },
                  {
                    key: 'opening', label: 'Opening', priority: 1, width: '80px', align: 'right',
                    render: product => <span className="text-xs text-text-3">{(reportStats.get(product.id)?.monthly ?? { opening: 0 }).opening}</span>,
                    exportValue: product => (reportStats.get(product.id)?.monthly ?? { opening: 0 }).opening,
                  },
                  {
                    key: 'purchases', label: 'Purchases', priority: 2, width: '80px', align: 'right',
                    render: product => <span className="text-xs text-emerald-600 font-medium">+{(reportStats.get(product.id)?.monthly ?? { purchases: 0 }).purchases}</span>,
                    exportValue: product => (reportStats.get(product.id)?.monthly ?? { purchases: 0 }).purchases,
                  },
                  {
                    key: 'sales', label: 'Sales', priority: 2, width: '80px', align: 'right',
                    render: product => <span className="text-xs text-red-600 font-medium">-{(reportStats.get(product.id)?.monthly ?? { sales: 0 }).sales}</span>,
                    exportValue: product => (reportStats.get(product.id)?.monthly ?? { sales: 0 }).sales,
                  },
                  {
                    key: 'usage', label: 'Usage', priority: 3, width: '80px', align: 'right',
                    render: product => <span className="text-xs text-amber-600 font-medium">-{(reportStats.get(product.id)?.monthly ?? { usage: 0 }).usage}</span>,
                    exportValue: product => (reportStats.get(product.id)?.monthly ?? { usage: 0 }).usage,
                  },
                  {
                    key: 'closing', label: 'Closing', priority: 1, width: '80px', align: 'right',
                    render: product => <span className="text-xs font-bold text-primary-700">{(reportStats.get(product.id)?.monthly ?? { closing: 0 }).closing}</span>,
                    exportValue: product => (reportStats.get(product.id)?.monthly ?? { closing: 0 }).closing,
                  },
                ]}
                rows={reportFilteredProducts}
                rowKey={p => p.id}
                hideSearch
                emptyMessage="No products match these filters"
                exportTitle="Opening vs Closing"
                exportFilename="inventory-opening-closing"
                perPage={20}
              />
            </div>
          )}

          {reportTab === 'movements' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Stock Movements" count={filteredReportMoves.length} />
              <DataTable
                tableId="inventory-report-movements"
                columns={[
                  {
                    key: 'date', label: 'Date', priority: 1, width: '100px',
                    render: move => <span className="text-xs text-text-3">{fmtDate(move.date)}</span>,
                    exportValue: move => move.date,
                  },
                  {
                    key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                    render: move => <span className="text-xs text-text-1 font-medium">{move.productName}</span>,
                    exportValue: move => move.productName,
                  },
                  {
                    key: 'type', label: 'Type', priority: 1, width: '100px',
                    render: move => <Badge status={move.type === 'in' ? 'active' : move.type === 'transfer' ? 'pending' : 'cancelled'} label={move.type} />,
                    exportValue: move => move.type,
                  },
                  {
                    key: 'qty', label: 'Qty', priority: 1, width: '60px',
                    render: move => <span className="text-xs font-bold text-text-1">{move.qty}</span>,
                    exportValue: move => move.qty,
                  },
                  {
                    key: 'source', label: 'Source', priority: 2, width: '120px',
                    render: move => <span className="text-xs text-text-3">{move.fromLocation ? LOCATIONS[move.fromLocation].name : '—'}</span>,
                    exportValue: move => move.fromLocation ? LOCATIONS[move.fromLocation].name : '',
                  },
                  {
                    key: 'destination', label: 'Destination', priority: 2, width: '120px',
                    render: move => <span className="text-xs text-text-3">{move.toLocation ? LOCATIONS[move.toLocation].name : '—'}</span>,
                    exportValue: move => move.toLocation ? LOCATIONS[move.toLocation].name : '',
                  },
                  {
                    key: 'document', label: 'Document', priority: 2, width: '120px',
                    render: move => <span className="font-mono text-[11px] font-bold text-primary-700">{move.documentRef}</span>,
                    exportValue: move => move.documentRef,
                  },
                  {
                    key: 'reason', label: 'Reason', priority: 3, width: '1fr',
                    render: move => <span className="text-[10px] text-text-3 truncate">{move.reason}</span>,
                    exportValue: move => move.reason,
                  },
                ]}
                rows={[...filteredReportMoves].reverse()}
                rowKey={m => m.id}
                hideSearch
                emptyMessage="No movements for this period"
                exportTitle="Stock Movements"
                exportFilename="inventory-movements"
                perPage={20}
              />
            </div>
          )}

          {reportTab === 'serial_tracking' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Serial Tracking Report" count={displayedTrackedSerials.length} />
              <div className="px-4 py-3 border-b border-[var(--border-lt)] grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Search serial">
                  <Input value={serialReportSearch} onChange={setSerialReportSearch} placeholder="e.g. PF1CX9NP" />
                </Field>
                <Field label="Status">
                  <Select
                    value={serialReportStatus}
                    onChange={v => setSerialReportStatus(v as typeof serialReportStatus)}
                    options={[
                      { value: 'all', label: 'All statuses' },
                      { value: 'available', label: 'Available' },
                      { value: 'assigned', label: 'Reserved (assigned)' },
                      { value: 'sold', label: 'Sold' },
                      { value: 'refurbishment', label: 'Refurbishment' },
                      { value: 'under_repair', label: 'Under repair' },
                      { value: 'returned', label: 'Returned' },
                      { value: 'written_off', label: 'Written off' },
                    ]}
                  />
                </Field>
              </div>
              <DataTable
                tableId="inventory-report-serials"
                columns={[
                  {
                    key: 'serial', label: 'Serial number', priority: 1, width: '140px',
                    render: serial => <span className="font-mono text-[11px] font-bold text-primary-700">{serial.serial}</span>,
                    exportValue: serial => serial.serial,
                  },
                  {
                    key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                    render: serial => <span className="text-xs text-text-1 font-medium">{serial.productName}</span>,
                    exportValue: serial => serial.productName,
                  },
                  {
                    key: 'purchaseRef', label: 'Purchase ref', priority: 2, width: '120px',
                    render: serial => <span className="font-mono text-[10px] text-text-3">{serial.purchaseOrderId ?? 'OPENING'}</span>,
                    exportValue: serial => serial.purchaseOrderId ?? 'OPENING',
                  },
                  {
                    key: 'location', label: 'Current location', priority: 2, width: '140px',
                    render: serial => <span className="text-xs text-text-3">{LOCATIONS[serial.location].icon} {LOCATIONS[serial.location].name}</span>,
                    exportValue: serial => LOCATIONS[serial.location].name,
                  },
                  {
                    key: 'status', label: 'Status', priority: 1, width: '120px',
                    render: serial => <Badge status={serial.status === 'available' ? 'active' : serial.status === 'sold' ? 'done' : serial.status === 'assigned' ? 'pending' : serial.status === 'under_repair' ? 'pending' : 'cancelled'} label={serial.status.replace(/_/g, ' ')} />,
                    exportValue: serial => serial.status.replace(/_/g, ' '),
                  },
                  {
                    key: 'received', label: 'Received', priority: 3, width: '100px',
                    render: serial => <span className="text-xs text-text-3">{fmtDate(serial.receivedDate)}</span>,
                    exportValue: serial => serial.receivedDate,
                  },
                ]}
                rows={displayedTrackedSerials}
                rowKey={s => s.id}
                hideSearch
                emptyMessage="No serial records match this filter — try Find Serial for a global search"
                exportTitle="Serial Tracking"
                exportFilename="inventory-serials"
                perPage={20}
                rowActions={row => (
                  (row.status === 'assigned' || row.status === 'returned') && canReleaseSerials ? (
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg border text-[10px] font-bold text-amber-800 border-amber-300 bg-amber-50"
                      onClick={() => releaseSerialToStock(row.id, 'warehouse')}
                    >
                      Release
                    </button>
                  ) : null
                )}
              />
            </div>
          )}

          {reportTab === 'serial_lookup' && (
            <div className="card p-4 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-text-1">Find a serial</h3>
                <p className="text-[11px] text-text-3 mt-1">
                  Search any serial (including sold / reserved). Example: look up <span className="font-mono">PF1CX9NP</span> to see where it went.
                </p>
              </div>
              <Field label="Serial or asset tag">
                <Input value={serialLookupQuery} onChange={setSerialLookupQuery} placeholder="Paste serial e.g. PF1CX9NP" />
              </Field>
              {!serialLookupQuery.trim() && (
                <p className="text-xs text-text-4">Enter a serial number to see status, location, linked sale order, and stock moves.</p>
              )}
              {serialLookupQuery.trim() && serialLookupResults.length === 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                  No record found for <span className="font-mono font-bold">{serialLookupQuery.trim()}</span>.
                  It may have been renamed via Edit serial, never received into Deed, or belong to a different product spelling.
                  Also check Stock Movements for that product around the date it disappeared.
                </div>
              )}
              {serialLookupResults.map(result => (
                <div key={result.serial.id} className="rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-primary-800">{result.serial.serial}</p>
                      <p className="text-xs text-text-2 mt-0.5">{result.serial.productName}</p>
                    </div>
                    <Badge
                      status={result.serial.status === 'available' ? 'active' : result.serial.status === 'sold' ? 'done' : 'pending'}
                      label={result.serial.status.replace(/_/g, ' ')}
                    />
                  </div>
                  <p className="text-xs font-semibold text-text-1">{result.summary}</p>
                  <ul className="text-[11px] text-text-3 space-y-1 list-disc pl-4">
                    {result.details.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                  {(result.serial.status === 'assigned' || result.serial.status === 'returned') && canReleaseSerials && (
                    <button
                      type="button"
                      className="btn-secondary text-[11px]"
                      onClick={() => releaseSerialToStock(result.serial.id, 'warehouse')}
                    >
                      Release back to on hand
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {reportTab === 'low_stock' && (
            <div className="card overflow-hidden">
              <PanelHeader title="Low Stock Alert" count={filteredLowStock.length} />
              <DataTable
                tableId="inventory-report-low-stock"
                columns={[
                  {
                    key: 'product', label: 'Product', priority: 1, width: '1.5fr',
                    render: product => <span className="text-xs text-text-1 font-medium">{product.name}</span>,
                    exportValue: product => product.name,
                  },
                  {
                    key: 'category', label: 'Category', priority: 2, width: '1fr',
                    render: product => <span className="text-xs text-text-3">{product.category}</span>,
                    exportValue: product => product.category,
                  },
                  {
                    key: 'onHand', label: 'On hand', priority: 1, width: '100px', align: 'right',
                    render: product => {
                      const locs = getStockByLocation(product.id)
                      const onHand = (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
                      return <span className="text-xs font-bold" style={{ color: onHand === 0 ? 'var(--danger)' : 'var(--warning)' }}>{onHand}</span>
                    },
                    exportValue: product => {
                      const locs = getStockByLocation(product.id)
                      return (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
                    },
                  },
                  {
                    key: 'reorder', label: 'Reorder level', priority: 2, width: '120px', align: 'right',
                    render: product => <span className="text-xs text-text-3">{product.minStock}</span>,
                    exportValue: product => product.minStock,
                  },
                  {
                    key: 'deficit', label: 'Deficit', priority: 1, width: '100px', align: 'right',
                    render: product => {
                      const locs = getStockByLocation(product.id)
                      const onHand = (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
                      return <span className="text-xs font-bold text-red-600">-{Math.max(0, product.minStock - onHand)}</span>
                    },
                    exportValue: product => {
                      const locs = getStockByLocation(product.id)
                      const onHand = (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
                      return -Math.max(0, product.minStock - onHand)
                    },
                  },
                  {
                    key: 'status', label: 'Status', priority: 1, width: '120px',
                    render: product => {
                      const locs = getStockByLocation(product.id)
                      const onHand = (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
                      return <Badge status={onHand === 0 ? 'cancelled' : 'pending'} label={onHand === 0 ? 'Out of Stock' : 'Low Stock'} />
                    },
                    exportValue: product => {
                      const locs = getStockByLocation(product.id)
                      const onHand = (locs.warehouse ?? 0) + (locs.shop ?? 0) + (locs.repair_unit ?? 0)
                      return onHand === 0 ? 'Out of Stock' : 'Low Stock'
                    },
                  },
                ]}
                rows={filteredLowStock}
                rowKey={p => p.id}
                hideSearch
                emptyMessage="No low-stock products"
                exportTitle="Low Stock Alert"
                exportFilename="inventory-low-stock"
                perPage={20}
              />
            </div>
          )}

          {reportTab === 'valuation' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Blob on-hand vs Prisma valuation (automated inventory asset). Drift means qty and books disagree.
                </p>
                <button
                  type="button"
                  className="btn-secondary text-[11px] px-3 py-1.5"
                  onClick={async () => {
                    setValuationReport(prev => ({ ...(prev || {}), loading: true, error: undefined }))
                    try {
                      const res = await fetch('/api/inventory/valuation-report')
                      const data = await res.json().catch(() => ({}))
                      if (!res.ok) {
                        setValuationReport({ loading: false, error: data.error || 'Failed to load valuation' })
                        return
                      }
                      setValuationReport({ ...data, loading: false })
                    } catch {
                      setValuationReport({ loading: false, error: 'Could not reach server' })
                    }
                  }}
                >
                  {valuationReport?.loading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              {valuationReport?.error && (
                <p className="text-xs text-red-700">{valuationReport.error}</p>
              )}
              {valuationReport?.totals && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="border border-[var(--color-border)] p-2">
                    <div className="text-[var(--color-text-muted)]">On hand (blob)</div>
                    <div className="tabular-nums font-medium">{valuationReport.totals.onHand}</div>
                  </div>
                  <div className="border border-[var(--color-border)] p-2">
                    <div className="text-[var(--color-text-muted)]">Valuation qty</div>
                    <div className="tabular-nums font-medium">{valuationReport.totals.valuationQty}</div>
                  </div>
                  <div className="border border-[var(--color-border)] p-2">
                    <div className="text-[var(--color-text-muted)]">Inventory value</div>
                    <div className="tabular-nums font-medium">{fmtKes(valuationReport.totals.totalValue)}</div>
                  </div>
                  <div className="border border-[var(--color-border)] p-2">
                    <div className="text-[var(--color-text-muted)]">Qty drift lines</div>
                    <div className="tabular-nums font-medium">{valuationReport.totals.driftLines}</div>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto border border-[var(--color-border)]">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--color-surface-muted)] text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Product</th>
                      <th className="px-2 py-1.5 font-medium text-right">On hand</th>
                      <th className="px-2 py-1.5 font-medium text-right">Val qty</th>
                      <th className="px-2 py-1.5 font-medium text-right">Drift</th>
                      <th className="px-2 py-1.5 font-medium text-right">Avg cost</th>
                      <th className="px-2 py-1.5 font-medium text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(valuationReport?.rows || []).slice(0, 200).map(row => (
                      <tr key={row.productId} className="border-t border-[var(--color-border)]">
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-[var(--color-text-muted)]">{row.sku}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{row.onHand}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{row.valuationQty}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${row.qtyDrift !== 0 ? 'text-amber-700' : ''}`}>{row.qtyDrift}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtKes(row.averageCost)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtKes(row.totalValue)}</td>
                      </tr>
                    ))}
                    {(!valuationReport?.rows || valuationReport.rows.length === 0) && !valuationReport?.loading && (
                      <tr>
                        <td colSpan={6} className="px-2 py-6 text-center text-[var(--color-text-muted)]">
                          Click Refresh to load valuation.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Product label print modal ── */}
      {labelProduct && (
        <Modal title="Print Product Label" onClose={() => setLabelProduct(null)} width={420}>
          <div className="flex flex-col gap-4">
            {/* Preview */}
            <div className="border border-border-lt rounded-xl p-4 bg-surface flex gap-4 items-center">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-50 to-sky-50 border border-primary-100 flex items-center justify-center text-2xl flex-shrink-0 text-slate-500">
                {labelProduct.image && !/^\p{Extended_Pictographic}/u.test(labelProduct.image)
                  ? <img src={labelProduct.image} alt="" className="w-10 h-10 object-contain" />
                  : <Fa icon={faBox} aria-hidden="true" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-text-1 truncate" title={labelProduct.name}>{labelProduct.name}</p>
                <p className="text-xs text-text-3 font-mono mt-0.5">{labelProduct.sku}</p>
                <p className="text-xs font-bold text-primary-700 mt-0.5">{fmtKes(labelProduct.salePrice)}</p>
                {labelProduct.barcode && (
                  <p className="text-[10px] text-text-4 mt-0.5">Barcode: {labelProduct.barcode}</p>
                )}
              </div>
            </div>

            {/* Label content info */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1">
              <p className="font-bold text-slate-700 mb-1.5">Each label includes:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <span>✓ Product name</span>
                <span>✓ Sale price</span>
                <span>✓ SKU</span>
                <span>✓ Category</span>
                <span>✓ CODE128 barcode</span>
                <span>✓ Deed brand mark</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                Barcode value: <span className="font-mono font-bold">{labelProduct.barcode || labelProduct.sku}</span>
                {!labelProduct.barcode && <span className="text-amber-600"> (using SKU — add a barcode in Product Edit for a dedicated value)</span>}
              </p>
            </div>

            {/* Quantity selector */}
            <Field label="How many labels?">
              <div className="flex gap-2 flex-wrap">
                {[1, 5, 10, 20, 50].map(n => (
                  <button key={n} onClick={() => setLabelQty(String(n))}
                    className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${labelQty === String(n) ? 'bg-primary-600 text-white border-primary-600' : 'bg-surface border-border-lt text-text-2 hover:border-primary-300'}`}>
                    {n}
                  </button>
                ))}
                <input
                  type="number" min="1" max="500"
                  value={labelQty}
                  onChange={e => setLabelQty(e.target.value)}
                  className="form-input w-20 text-sm font-bold text-center"
                  placeholder="Custom"
                />
              </div>
              <p className="text-[10px] text-text-4 mt-1.5">Labels print 3-per-row on A4. {Math.ceil(Number(labelQty) / 3)} row{Math.ceil(Number(labelQty) / 3) !== 1 ? 's' : ''} needed.</p>
            </Field>

            <div className="flex gap-3 justify-end mt-2">
              <button className="btn-secondary px-6" onClick={() => setLabelProduct(null)}>Cancel</button>
              <button
                className="btn-primary px-8 flex items-center gap-2"
                disabled={!labelQty || Number(labelQty) < 1}
                onClick={() => { printProductLabels(labelProduct, Number(labelQty) || 1); setLabelProduct(null) }}
              >
                <Fa icon={faPrint} className="text-xs" />
                Print {labelQty || 1} Label{Number(labelQty) !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Product master form modal ── */}
      {showForm && (() => {
        const parentProduct = form.parentId ? products.find((p: Product) => p.id === form.parentId) : null
        const exactDup = !editId && !form.parentId && products.find((p: Product) => p.isActive && p.name.trim().toLowerCase() === form.name.trim().toLowerCase())
        return (
        <Modal title={editId ? 'Edit Product Master' : form.parentId ? 'Create Product Variant' : 'Create New Product'} onClose={closeProductForm} width={640}>
          <div className="flex flex-col gap-4">

            {!editId && !form.parentId && canEditStock && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 rounded-xl border border-sky-100 bg-sky-50/80">
                <p className="text-[11px] text-sky-900">
                  Creating many products? Download the Excel template and bulk upload instead.
                </p>
                <div className="flex gap-2 shrink-0">
                  <button type="button" className="btn-secondary text-[10px] px-2.5 py-1" onClick={downloadProductTemplate}>
                    Download template
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-[10px] px-2.5 py-1"
                    onClick={() => { setShowForm(false); productImportRef.current?.click() }}
                  >
                    Bulk upload
                  </button>
                </div>
              </div>
            )}

            {/* Variant banner */}
            {parentProduct && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--info-bg)]">
                <span className="text-xl text-slate-500" aria-hidden="true">
                  {parentProduct.image && !/^\p{Extended_Pictographic}/u.test(parentProduct.image)
                    ? <img src={parentProduct.image} alt="" className="w-7 h-7 object-contain" />
                    : <Fa icon={faBox} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--navy)' }}>Variant of</p>
                  <p className="text-[13px] font-extrabold text-text-1 truncate" title={parentProduct.name}>{parentProduct.name}</p>
                  <p className="text-[10px] text-text-3">Inherits category &amp; account mapping · Give this variant a unique name, SKU, price and description</p>
                </div>
                <button className="text-[10px] text-text-3 underline hover:text-red-500 transition-colors" onClick={() => setF('parentId')('')}>Remove link</button>
              </div>
            )}

            {/* Duplicate confirmation banner */}
            {dupConfirm && exactDup && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-bg)]">
                <span className="text-lg mt-0.5 text-amber-600" aria-hidden="true"><Fa icon={faTriangleExclamation} /></span>
                <div className="flex-1">
                  <p className="text-[12px] font-bold text-amber-800">Product already exists</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    <strong>&ldquo;{(exactDup as Product).name}&rdquo;</strong> is already in your catalogue.
                    If this is a different configuration, consider using <strong>Create Variant</strong> instead,
                    or update the name to distinguish it.
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button className="px-3 py-1 rounded-lg text-[11px] font-bold border border-amber-300 bg-white text-amber-800 hover:bg-amber-50 transition-colors"
                      onClick={() => openVariant(exactDup as Product)}>
                      Create Variant of existing
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Field label="Product Name" required>
                  <Input value={form.name} onChange={(v: string) => { setF('name')(v); setDupConfirm(false) }} placeholder="e.g. HP ProBook 450 G9" />
                </Field>
                {/* Live similar-name hint */}
                {nameSimilarProducts.length > 0 && !dupConfirm && !editId && (
                  <div className="mt-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--info-bg)] text-[10px]">
                    <p className="font-bold text-[var(--info-text)] mb-1">Similar products already in catalogue:</p>
                    {nameSimilarProducts.map((p: Product) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="text-text-2 truncate inline-flex items-center gap-1.5 min-w-0">
                          {p.image && !/^\p{Extended_Pictographic}/u.test(p.image)
                            ? <img src={p.image} alt="" className="w-4 h-4 object-contain flex-shrink-0" />
                            : <Fa icon={faBox} className="text-slate-400 flex-shrink-0" aria-hidden="true" />}
                          <span className="truncate" title={`${p.name} ${p.sku}`}>{p.name} <span className="text-text-4 font-mono">{p.sku}</span></span>
                        </span>
                        <div className="flex gap-1 shrink-0">
                          <button className="px-2 py-0.5 rounded text-[9px] font-bold bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                            onClick={() => openVariant(p)}>+ Variant</button>
                          <button className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors"
                            onClick={() => { setShowForm(false); openEdit(p) }}>Edit existing</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Product Type" required>
                <Select
                  value={form.productKind || inferProductKind(form)}
                  onChange={(value) => {
                    const kind = value as ProductKind
                    const tracking = defaultTrackingForKind(kind, form.category)
                    setForm((prev: any) => ({
                      ...prev,
                      productKind: kind,
                      trackingMethod: tracking,
                      unit: defaultUnitForKind(kind, tracking),
                      ...((kind === 'service')
                        ? { inventoryAccountCode: '', cogsAccountCode: '', minStock: '0' }
                        : {}),
                    }))
                  }}
                  options={PRODUCT_KIND_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                />
              </Field>
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(value) => {
                    const defaults = applyCategoryAccountDefaults(value, {
                      productKind: form.productKind,
                      saleAccountCode: '',
                      costAccountCode: '',
                      inventoryAccountCode: '',
                      cogsAccountCode: '',
                      adjustmentAccountCode: '',
                      writeOffAccountCode: '',
                      priceDifferenceAccountCode: '',
                    })
                    const kind = defaults.productKind
                    const tracking = defaultTrackingForKind(kind, value)
                    setForm((prev: any) => {
                      const suggested = suggestSalePriceFromCost(systemSettings.invCategorySaleMarkupPct, value, prev.costPrice, {
        policy: systemSettings.pricingMarginPolicy,
        legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
      })
                      return {
                        ...prev,
                        category: value,
                        productKind: kind,
                        trackingMethod: tracking,
                        unit: defaultUnitForKind(kind, tracking),
                        saleAccountCode: defaults.saleAccountCode,
                        costAccountCode: defaults.costAccountCode,
                        inventoryAccountCode: kind === 'storable' ? defaults.inventoryAccountCode : '',
                        cogsAccountCode: kind === 'storable' ? defaults.cogsAccountCode : '',
                        adjustmentAccountCode: defaults.adjustmentAccountCode,
                        writeOffAccountCode: defaults.writeOffAccountCode,
                        priceDifferenceAccountCode: defaults.priceDifferenceAccountCode,
                        ...(suggested !== null ? { salePrice: String(suggested) } : {}),
                      }
                    })
                  }}
                  options={ALL_CATEGORIES.map(c => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Tracking Method">
                <Select
                  value={isSerialOnlyCategory(form.category) ? 'SERIAL' : form.trackingMethod}
                  onChange={(value) => {
                    if (isSerialOnlyCategory(form.category)) return
                    setF('trackingMethod')(value)
                    if (value === 'NONE') setF('productKind')('service')
                    else if (form.productKind === 'service') setF('productKind')('storable')
                  }}
                  options={
                    isSerialOnlyCategory(form.category)
                      ? [{ value: 'SERIAL', label: 'SERIAL (unit tracked) — required for this category' }]
                      : [
                          { value: 'NONE', label: 'NONE (non-stock/service)' },
                          { value: 'QUANTITY', label: 'QUANTITY (bulk qty)' },
                          { value: 'BATCH', label: 'BATCH (lot tracked)' },
                          { value: 'SERIAL', label: 'SERIAL (unit tracked)' },
                        ]
                  }
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Unit of Measure">
                <Select
                  value={form.unit || 'pcs'}
                  onChange={setF('unit')}
                  options={UOM_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                />
              </Field>
              <Field label="Barcode">
                <div className="flex gap-2">
                  <Input value={form.barcode} onChange={setF('barcode')} placeholder="Optional product barcode" />
                  <button type="button" className="btn-secondary px-3 text-[11px] whitespace-nowrap" onClick={() => setF('barcode')(buildProductBarcode(form.sku || form.name, form.name, products, editId || undefined))}>Generate</button>
                </div>
              </Field>
              <Field label="Min Stock">
                <Input type="number" value={form.minStock} onChange={setF('minStock')} disabled={form.productKind === 'service'} />
              </Field>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-text-2 cursor-pointer">
                <input type="checkbox" checked={!!form.canBeSold} onChange={e => setF('canBeSold')(e.target.checked)} />
                Can be Sold
              </label>
              <label className="flex items-center gap-2 text-[12px] font-semibold text-text-2 cursor-pointer">
                <input type="checkbox" checked={!!form.canBePurchased} onChange={e => setF('canBePurchased')(e.target.checked)} />
                Can be Purchased
              </label>
              <label className="flex items-center gap-2 text-[12px] font-semibold text-text-2 cursor-pointer" title="Inactive products are archived — hidden from sales/purchase pickers">
                <input type="checkbox" checked={!!form.isActive} onChange={e => setF('isActive')(e.target.checked)} />
                Active (uncheck to archive)
              </label>
            </div>
            {(form.barcode || form.name) && (
              <div className="rounded-xl border border-border-lt bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="text-[10px] uppercase font-bold text-text-3 mb-1">Barcode Preview</p>
                  <p className="font-mono text-xs font-bold text-text-1">{form.barcode || 'Click Generate to create a Deed barcode'}</p>
                </div>
                {form.barcode ? <Barcode value={form.barcode} width={1.2} height={42} /> : null}
              </div>
            )}
            <Field label="Pricing band">
              <Select
                value={form.pricingCategoryId || ''}
                onChange={v => {
                  setForm((prev: any) => {
                    const next = { ...prev, pricingCategoryId: v }
                    const suggested = suggestSalePriceFromCost(systemSettings.invCategorySaleMarkupPct, next.category, next.costPrice, {
                      policy: systemSettings.pricingMarginPolicy,
                      pricingCategoryId: v || undefined,
                      legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
                    })
                    return suggested !== null ? { ...next, salePrice: String(suggested) } : next
                  })
                }}
                options={[
                  { value: '', label: 'Default from category mapping' },
                  ...normalizePricingMarginPolicy(systemSettings.pricingMarginPolicy).categories.map(c => ({
                    value: c.id,
                    label: `${c.name} (${c.minGpMarginPct}-${c.maxGpMarginPct}%)`,
                  })),
                ]}
              />
            </Field>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Sale Price">
                <Input type="number" value={form.salePrice} onChange={setF('salePrice')} />
              </Field>
              <Field label="Cost Price">
                <Input
                  type="number"
                  value={form.costPrice}
                  onChange={v => {
                    setForm((prev: any) => {
                      const suggested = suggestSalePriceFromCost(systemSettings.invCategorySaleMarkupPct, prev.category, v, {
        policy: systemSettings.pricingMarginPolicy,
        legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
      })
                      return {
                        ...prev,
                        costPrice: v,
                        ...(suggested !== null ? { salePrice: String(suggested) } : {}),
                      }
                    })
                  }}
                />
              </Field>
              <Field label="Tax Rate (%)"><Input type="number" value={form.taxRate} onChange={setF('taxRate')} /></Field>
            </div>
            {(() => {
              const quote = quoteSalePriceFromCost({
                costPrice: form.costPrice,
                erpCategory: form.category,
                pricingCategoryId: form.pricingCategoryId,
                policy: systemSettings.pricingMarginPolicy,
                legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
              })
              if (quote.ok) {
                return (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--info-bg)] px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <p className="text-[11px] text-[var(--navy)] leading-relaxed m-0">
                      <strong>{quote.category.name}</strong>: quote {fmtKes(quote.min.sellExVatRounded)}–{fmtKes(quote.max.sellExVatRounded)} ex VAT
                      (overhead {quote.overheadRatePct.toFixed(1)}%). List fills at max. Settings → Sales → Margin calculator.
                    </p>
                    <div className="flex gap-2 flex-shrink-0">
                      <button type="button" className="btn-secondary text-[11px] px-3 py-1.5" onClick={() => setF('salePrice')(String(quote.min.sellExVatRounded))}>Min</button>
                      <button type="button" className="btn-secondary text-[11px] px-3 py-1.5" onClick={() => setF('salePrice')(String(quote.max.sellExVatRounded))}>Max</button>
                    </div>
                  </div>
                )
              }
              if ('legacySale' in quote && quote.legacySale != null) {
                return (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--info-bg)] px-3 py-2.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-[var(--navy)] m-0">Legacy markup suggested {fmtKes(quote.legacySale)}</p>
                    <button type="button" className="btn-secondary text-[11px] px-3 py-1.5" onClick={() => setF('salePrice')(String(quote.legacySale))}>Recalculate</button>
                  </div>
                )
              }
              return null
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Warranty (Months)"><Input type="number" value={form.warrantyMonths} onChange={setF('warrantyMonths')} /></Field>
              <Field label="Icon / Image"><Input value={form.image} onChange={setF('image')} placeholder="Image URL" /></Field>
            </div>
            <Field label="Invoicing Policy">
              <Select value={form.invoicePolicy} onChange={setF('invoicePolicy')} options={[
                { value: 'order', label: 'Ordered Quantities — invoice after order confirmation' },
                { value: 'delivery', label: 'Delivered Quantities — invoice only what has been delivered' },
              ]} />
            </Field>
            <Field label="Description"><Input value={form.description} onChange={setF('description')} placeholder="Technical specs, condition, etc." /></Field>

            {/* Account Mapping — collapsible */}
            <div className="rounded-xl border border-[var(--border)] overflow-hidden">
              <button
                type="button"
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer ${showAcctMapping ? 'bg-[var(--primary-light)]' : 'bg-[var(--info-bg)] hover:bg-[var(--primary-light)]'}`}
                onClick={() => setShowAcctMapping(v => !v)}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--navy)]">
                  Account Mapping (Chart of Accounts)
                </span>
                <span className="text-[11px] font-bold text-[var(--primary)]">
                  {showAcctMapping ? '▾ Hide' : '▸ Show'}
                </span>
              </button>
              {showAcctMapping && (
                <div className="px-4 pb-4 pt-3 bg-[var(--bg-surface)]">
                  <p className="text-[10px] text-text-3 mb-3">
                    Empty fields inherit the <strong>{form.category}</strong> category defaults, then company fallbacks.
                    Only storable products require Inventory Asset and COGS.
                  </p>
                  {accounts.length === 0 ? (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      No accounts found. Open the <strong>Accounting</strong> module to set up your Chart of Accounts first.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Revenue Account (Sales)">
                        <Select
                          value={form.saleAccountCode}
                          onChange={v => setF('saleAccountCode')(v)}
                          options={[{ value: '', label: '— Category / company default —' }, ...acctOpt(revenueAccounts)]}
                        />
                      </Field>
                      {(form.canBePurchased || form.productKind !== 'service') && (
                        <Field label="Purchase / Cost Account">
                          <Select
                            value={form.costAccountCode}
                            onChange={v => setF('costAccountCode')(v)}
                            options={[{ value: '', label: '— Category / company default —' }, ...acctOpt(costAccounts)]}
                          />
                        </Field>
                      )}
                      {kindRequiresInventoryAccounts(form.productKind || 'storable') && (
                        <>
                          <Field label="Inventory Asset Account">
                            <Select
                              value={form.inventoryAccountCode}
                              onChange={v => setF('inventoryAccountCode')(v)}
                              options={[{ value: '', label: '— Required (category default OK) —' }, ...acctOpt(assetAccounts)]}
                            />
                          </Field>
                          <Field label="COGS Account">
                            <Select
                              value={form.cogsAccountCode}
                              onChange={v => setF('cogsAccountCode')(v)}
                              options={[{ value: '', label: '— Required (category default OK) —' }, ...acctOpt(inventoryExpenseAccounts)]}
                            />
                          </Field>
                          <Field label="Adjustment / Variance Account">
                            <Select
                              value={form.adjustmentAccountCode}
                              onChange={v => setF('adjustmentAccountCode')(v)}
                              options={[{ value: '', label: '— Optional fallback —' }, ...acctOpt(inventoryExpenseAccounts)]}
                            />
                          </Field>
                          <Field label="Write-off / Damage Account">
                            <Select
                              value={form.writeOffAccountCode}
                              onChange={v => setF('writeOffAccountCode')(v)}
                              options={[{ value: '', label: '— Optional fallback —' }, ...acctOpt(inventoryExpenseAccounts)]}
                            />
                          </Field>
                          <Field label="Price Difference Account">
                            <Select
                              value={form.priceDifferenceAccountCode}
                              onChange={v => setF('priceDifferenceAccountCode')(v)}
                              options={[{ value: '', label: '— PO vs bill variance —' }, ...acctOpt(inventoryExpenseAccounts)]}
                            />
                          </Field>
                        </>
                      )}
                      {form.productKind === 'consumable' && (
                        <Field label="Price Difference Account">
                          <Select
                            value={form.priceDifferenceAccountCode}
                            onChange={v => setF('priceDifferenceAccountCode')(v)}
                            options={[{ value: '', label: '— PO vs bill variance —' }, ...acctOpt(inventoryExpenseAccounts)]}
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-2">
              <button className="btn-secondary px-6" onClick={closeProductForm}>Cancel</button>
              <button className="btn-primary px-8" onClick={() => { void saveProduct() }} disabled={dupConfirm && !!exactDup}>
                {dupConfirm && exactDup ? 'Resolve duplicate above' : 'Save Product'}
              </button>
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* ── Product bulk import preview modal ── */}
      {showImportModal && (
        <Modal title="Import Products — Preview" onClose={() => { setShowImportModal(false); setImportRows([]) }} width={780}>
          <div>
          <div className="px-3 py-2 text-[11px] bg-emerald-50 border border-emerald-100 rounded-lg mb-4 text-emerald-800">
            <strong>{importRows.filter(r => r.status === 'new').length} new</strong> will be published if they do not already exist &nbsp;·&nbsp;
            <strong>{importRows.filter(r => r.status === 'exists').length} already exist</strong> &nbsp;·&nbsp;
            <strong>{importRows.filter(r => r.status === 'duplicate').length} duplicates in file</strong> &nbsp;·&nbsp;
            <strong>{importRows.filter(r => r.status === 'invalid').length} invalid</strong>
          </div>
          <DataTable
            tableId="inventory-product-import"
            columns={[
              {
                key: 'status', label: 'Status', priority: 1, width: '110px',
                render: row => (
                  <>
                    {row.status === 'new' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">New</span>}
                    {row.status === 'exists' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700">Exists</span>}
                    {row.status === 'duplicate' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">Duplicate</span>}
                    {row.status === 'invalid' && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-700">Invalid</span>}
                  </>
                ),
                exportValue: row => row.status,
              },
              {
                key: 'name', label: 'Name', priority: 1, width: '1.5fr',
                render: row => <span className="text-xs text-text-1 font-medium truncate" title={row.name || undefined}>{row.name || <span className="text-text-4 italic">—</span>}</span>,
                exportValue: row => row.name,
              },
              {
                key: 'sku', label: 'SKU', priority: 1, width: '120px',
                render: row => <span className="font-mono text-[10px] text-text-3">{row.sku || <span className="text-text-4 italic">—</span>}</span>,
                exportValue: row => row.sku,
              },
              {
                key: 'salePrice', label: 'Sale price', priority: 2, width: '100px', align: 'right',
                render: row => <span className="text-xs text-text-3">{row.salePrice ? fmtKes(row.salePrice) : '—'}</span>,
                exportValue: row => row.salePrice || '',
              },
              {
                key: 'costPrice', label: 'Cost price', priority: 2, width: '100px', align: 'right',
                render: row => <span className="text-xs text-text-3">{row.costPrice ? fmtKes(row.costPrice) : '—'}</span>,
                exportValue: row => row.costPrice || '',
              },
              {
                key: 'category', label: 'Category', priority: 2, width: '100px',
                render: row => <span className="text-xs text-text-3">{row.category}</span>,
                exportValue: row => row.category,
              },
              {
                key: 'reason', label: 'Reason', priority: 3, width: '1.5fr',
                render: row => <span className="text-[10px] text-text-3 truncate" title={row.reason}>{row.reason || '—'}</span>,
                exportValue: row => row.reason || '',
              },
            ] as ColumnDef<ProductImportRow & { _key: string }>[]}
            rows={importRows.map((row, i) => ({ ...row, _key: `${row.sku || row.name || 'row'}-${i}` }))}
            rowKey={row => row._key}
            hideSearch
            emptyMessage="No import rows"
            rowClassName={row => row.status !== 'new' ? 'opacity-70' : ''}
            perPage={50}
          />
          <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-[11px] text-amber-800">
            Expected columns: <strong>Name, SKU, Category, Barcode, Sale Price, Cost Price, Tax Rate, Min Stock, Warranty Months, Description, Revenue Account, Purchase Account, Inventory Asset Account, COGS Account, Adjustment Account, Write-off Account</strong>
          </div>
          <div className="flex gap-3 justify-end mt-4">
            <button className="btn-secondary px-6" disabled={importBusy} onClick={() => { setShowImportModal(false); setImportRows([]) }}>Cancel</button>
            <button
              className="btn-primary px-8"
              onClick={() => { void confirmProductImport() }}
              disabled={importBusy || importRows.filter(r => r.status === 'new').length === 0}
            >
              {importBusy ? 'Publishing…' : `Publish ${importRows.filter(r => r.status === 'new').length} Products`}
            </button>
          </div>
          </div>
        </Modal>
      )}

      {/* ── Opening stock modal ── */}
      {showOpening && (
        <Modal title="Post Opening Stock" onClose={() => setShowOpening(false)} width={860}>
          <p className="text-amber-700 text-xs font-medium mb-4">Opening stock is allowed one time only and is locked permanently after posting.</p>

          {/* Two-type legend */}
          <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex gap-2.5">
              <span className="text-lg flex-shrink-0 text-indigo-600" aria-hidden="true"><Fa icon={faBarcode} /></span>
              <div>
                <p className="text-[11px] font-bold text-indigo-800">Serial Tracked</p>
                <p className="text-[10px] text-indigo-700 mt-0.5">Laptops, Desktops, Printers, Networking — enter each serial number separated by commas. Every unit is individually tracked.</p>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex gap-2.5">
              <span className="text-lg flex-shrink-0 text-slate-500" aria-hidden="true"><Fa icon={faBoxesStacked} /></span>
              <div>
                <p className="text-[11px] font-bold text-slate-700">Bulk / Qty Only</p>
                <p className="text-[10px] text-slate-600 mt-0.5">Parts &amp; Components, Accessories — enter quantity only. Batteries, casings, cables etc. are counted, not individually tracked.</p>
              </div>
            </div>
          </div>

          <div className="mb-4 p-4 bg-sky-50 border border-sky-100 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-sky-800 mb-1"><Fa icon={faArrowDown} /> Upload Excel / CSV</p>
              <p className="text-[10px] text-sky-700">Standard columns include <strong>SKU</strong>, <strong>Product Name</strong>, <strong>Tracking Method</strong>, <strong>Qty</strong>, <strong>Serials</strong>, <strong>Unit SKUs</strong>, <strong>Location</strong>, cost/price, condition, warranty, and notes.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button className="btn-secondary bg-white text-xs py-2 px-4" onClick={downloadOpeningInventoryTemplate}>Download Template</button>
              <button className="btn-secondary bg-white text-xs py-2 px-4" onClick={() => openingImportRef.current?.click()}>Choose File</button>
            </div>
          </div>

          {openingImportErrors.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-[10px] text-red-700 max-h-24 overflow-y-auto">
              {openingImportErrors.map((err, i) => <div key={i}>• {err}</div>)}
            </div>
          )}

          <div className="flex flex-col gap-3 max-h-[340px] overflow-y-auto pr-1">
            {openingLines.map((line, index) => {
              const lineProduct = products.find(p => p.id === line.productId)
              const isSerial = lineProduct?.requiresSerial ?? false
              const isBulk = !!lineProduct && !lineProduct.requiresSerial
              return (
                <div key={index} className={`rounded-xl border transition-colors ${isSerial ? 'border-indigo-100 bg-indigo-50/30' : isBulk ? 'border-slate-200 bg-slate-50/40' : 'border-border-lt bg-surface/60'}`}>
                  {/* Type badge header */}
                  {lineProduct && (
                    <div className={`px-3 py-1.5 rounded-t-xl border-b text-[10px] font-bold flex items-center gap-1.5 ${isSerial ? 'bg-[var(--navy)] border-[var(--navy)] text-white' : 'bg-[var(--navy)] border-[var(--navy)] text-white'}`}>
                      <span aria-hidden="true"><Fa icon={isSerial ? faBarcode : faBoxesStacked} /></span>
                      <span>{isSerial ? 'Serial Tracked — enter serial numbers below' : 'Bulk / Qty Only — enter quantity, no serial numbers needed'}</span>
                    </div>
                  )}
                  {lineProduct && (() => {
                    const lineVariants = stockableProducts.filter(p => p.parentId === lineProduct.id)
                    if (lineVariants.length > 0) return (
                      <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100">
                        <span className="text-[10px] text-indigo-700 font-bold flex-1">{lineVariants.length} variant{lineVariants.length !== 1 ? 's' : ''} found — expand to enter stock per variant</span>
                        <button className="text-[10px] font-black text-indigo-700 underline hover:text-indigo-900 transition-colors" onClick={() => {
                          setOpeningLines(prev => {
                            const without = prev.filter((_, row) => row !== index)
                            const variantLines = lineVariants.map(v => ({ productId: v.id, productName: v.name, qty: '0', serials: '', serialSkus: '', location: line.location }))
                            return [...without.slice(0, index), ...variantLines, ...without.slice(index)]
                          })
                        }}>
                          Expand Variants
                        </button>
                      </div>
                    )
                    return null
                  })()}
                  <div className="grid grid-cols-1 sm:grid-cols-[1.35fr_70px_1.25fr_1.05fr_120px_40px] gap-3 items-end sm:items-start p-3">
                    <SearchPicker
                      label="" placeholder="Select product..."
                      items={stockableProducts}
                      onSelect={product => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, productId: product.id, productName: product.name } : entry))}
                      renderItem={product => `${product.name} (${product.sku})`}
                    />
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-text-3 uppercase">{isBulk ? 'Qty ★' : 'Qty'}</label>
                      <Input type="number" value={line.qty}
                        onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, qty: value } : entry))} placeholder="Qty" />
                      {isBulk && <span className="text-[9px] text-primary-600 font-semibold">Only field needed</span>}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-text-3 uppercase">Serial Numbers</label>
                      {isSerial ? (
                        <Input value={line.serials}
                          onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, serials: value } : entry))} placeholder="SN001, SN002, SN003 — one per unit" />
                      ) : isBulk ? (
                        <div className="h-9 rounded-lg border border-dashed border-slate-200 bg-white flex items-center justify-center gap-1.5 text-[10px] text-text-4 italic">
                          <span>—</span>
                          <span>Not applicable for bulk items</span>
                        </div>
                      ) : (
                        <div className="h-9 rounded-lg border border-dashed border-gray-200 bg-white flex items-center justify-center text-[10px] text-text-4 italic">
                          Select a product first
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-text-3 uppercase">Unit SKUs</label>
                      {isSerial ? (
                        <>
                          <Input value={line.serialSkus}
                            onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, serialSkus: value } : entry))} placeholder="SKU001, AUTO, SKU003" />
                          <span className="text-[9px] text-indigo-600 font-semibold">Optional; match serial order. Blank/AUTO = generate.</span>
                        </>
                      ) : isBulk ? (
                        <div className="h-9 rounded-lg border border-dashed border-slate-200 bg-white flex items-center justify-center text-[10px] text-text-4 italic">—</div>
                      ) : (
                        <div className="h-9 rounded-lg border border-dashed border-gray-200 bg-white flex items-center justify-center text-[10px] text-text-4 italic">
                          Select product first
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-text-3 uppercase">Location</label>
                      <Select value={line.location}
                        onChange={value => setOpeningLines(prev => prev.map((entry, row) => row === index ? { ...entry, location: value as LocationId } : entry))} options={locationOpts} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-text-3 uppercase opacity-0 select-none">Del</label>
                      <button onClick={() => setOpeningLines(prev => prev.filter((_, row) => row !== index))}
                        className="bg-red-50 text-red-600 rounded-lg p-2 hover:bg-red-100 transition-colors w-full sm:w-auto h-9 flex items-center justify-center">✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          
          <button onClick={() => setOpeningLines(prev => [...prev, { productId: '', productName: '', qty: '1', serials: '', serialSkus: '', location: 'warehouse' }])}
            className="w-full mt-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-text-4 text-xs font-bold hover:border-primary-300 hover:text-primary-600 transition-all">
            + Add Row Manually
          </button>

          <div className="flex gap-3 justify-end mt-6">
            <button className="btn-secondary px-6" onClick={() => setShowOpening(false)}>Cancel</button>
            <button className="btn-primary px-8" onClick={handleOpeningPost}>Post Opening Stock</button>
          </div>
        </Modal>
      )}

      {/* ── Transfer modal ── */}
      {showTransfer && (
        <Modal title="Internal Stock Transfer" onClose={() => setShowTransfer(false)}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Source Location"><Select value={tFrom} onChange={value => setTFrom(value as LocationId)} options={locationOpts} /></Field>
              <Field label="Destination Location"><Select value={tTo} onChange={value => setTTo(value as LocationId)} options={locationOpts} /></Field>
            </div>
            <Field label="Product">
              <SearchPicker label="" placeholder="Select product..." items={stockableProducts} onSelect={product => { setTProd(product); setTSerials([]) }} renderItem={product => `${product.name} (on hand: ${product.stockQty})`} />
            </Field>
            {tProd && !tProd.requiresSerial && <Field label="Quantity"><Input type="number" value={tQty} onChange={setTQty} /></Field>}
            {tProd?.requiresSerial && (
              <Field label={`Serial Numbers (${tSerials.length} scanned)`}>
                <ScanInputRow
                  value={tScanInput}
                  onChange={setTScanInput}
                  onSubmit={() => addTransferSerial()}
                  onCameraScan={(code) => {
                    setTScanInput(code)
                    // Defer so state updates before add runs with latest input via direct parse
                    const parsed = parseScanPayload(code)
                    if (!parsed.candidates.length || !tProd) return
                    const existing = serials.find(s =>
                      s.productId === tProd.id
                      && s.location === tFrom
                      && identityMatchesScan(s, parsed),
                    )
                    if (!existing) {
                      showToast(`Unit "${parsed.normalized}" not found in ${LOCATIONS[tFrom].name}`, 'error')
                      return
                    }
                    if (tSerials.includes(existing.serial)) {
                      showToast('Serial already scanned', 'error')
                      return
                    }
                    setTSerials(prev => [...prev, existing.serial])
                    setTScanInput('')
                    showToast(`${existing.serial} added`, 'success')
                  }}
                  placeholder="Scan unit barcode / serial…"
                  continuous
                  cameraTitle="Scan units to transfer"
                />
                {tSerials.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tSerials.map(serial => (
                      <span key={serial} onClick={() => setTSerials(prev => prev.filter(x => x !== serial))}
                        className="px-2 py-1 rounded-md bg-primary-50 border border-primary-200 text-[10px] font-bold text-primary-700 cursor-pointer hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-all">
                        {serial} ✕
                      </span>
                    ))}
                  </div>
                )}
              </Field>
            )}
            <Field label="Notes"><Input value={tNotes} onChange={setTNotes} placeholder="Transfer notes" /></Field>
            <div className="flex gap-3 justify-end mt-2">
              <button className="btn-secondary px-6" onClick={() => setShowTransfer(false)}>Cancel</button>
              <button className="btn-primary px-8" onClick={handleTransfer}>Validate Transfer</button>
            </div>
          </div>
        </Modal>
      )}

      {pendingConfirm && (
        <Confirm
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          detail={pendingConfirm.detail}
          confirmLabel={pendingConfirm.confirmLabel}
          confirmColor={pendingConfirm.confirmColor}
          onConfirm={() => {
            pendingConfirm.action()
            setPendingConfirm(null)
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {showNewRefurb && refurbSerial && (
        <Modal
          title="Send for Refurbishment"
          onClose={() => { setShowNewRefurb(false); setRefurbSerial(null); setRefurbIssueDesc('') }}
          width={440}
        >
          <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-lt)' }}>
            <p className="text-xs font-semibold text-t1">{refurbSerial.productName}</p>
            <p className="font-mono text-[11px] text-t3">S/N: {refurbSerial.serial}</p>
          </div>
          <p className="text-[11px] text-text-3 mb-3">
            This creates a refurbishment job and moves the unit out of sellable stock. Cancel if you pressed this by mistake.
          </p>
          <Field label="Issue description *">
            <Textarea
              value={refurbIssueDesc}
              onChange={setRefurbIssueDesc}
              rows={3}
              placeholder="Describe the problem — e.g. cracked screen, battery failure…"
            />
          </Field>
          <div className="flex gap-2 justify-end mt-4">
            <button
              type="button"
              className="btn-outline"
              onClick={() => { setShowNewRefurb(false); setRefurbSerial(null); setRefurbIssueDesc('') }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (!refurbIssueDesc.trim()) { showToast('Enter an issue description', 'error'); return }
                createRefurbishmentJob(refurbSerial.id, refurbIssueDesc.trim())
                setShowNewRefurb(false)
                setRefurbSerial(null)
                setRefurbIssueDesc('')
                showToast('Sent to refurbishment')
              }}
            >
              Confirm send
            </button>
          </div>
        </Modal>
      )}
      </div>{/* mod-body */}
    </div>
  )
}
