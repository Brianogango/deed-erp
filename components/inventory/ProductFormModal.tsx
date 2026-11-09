'use client'

/**
 * The product master form — one form for creating and editing products,
 * used by Inventory and wherever a product is missing while working (a
 * quote line, an RFQ / purchase order line). Saving goes through the same
 * checks and addProduct / updateProduct as always.
 */
import React, { useCallback, useMemo, useState, useRef, useEffect, Suspense } from 'react'
import { loadXlsx } from '@/lib/xlsx-lazy'
import {
  useInventoryStore, Product, LOCATIONS, LocationId, CATEGORY_CONFIG, ALL_CATEGORIES, CategoryId,
  fmtKes, fmtDate, Account, AdjReason, SerialNumber,
  PRODUCT_KIND_OPTIONS, UOM_OPTIONS, inferProductKind, defaultTrackingForKind, defaultUnitForKind,
  kindRequiresInventoryAccounts, applyCategoryAccountDefaults, resolveProductAccounts,
} from '@/lib/store'
import type { ProductKind } from '@/lib/product-kind'
import {
  inventoryCategoryFilterOptions,
  resolveProductCreationCategoryOptions,
} from '@/lib/product-categories'
import { userCan } from '@/lib/auth/can'
import { Badge, Modal, Field, Input, Select, Confirm, PanelHeader, SearchPicker, ModuleSkeleton, ModuleHeader, TabBar, Textarea } from '@/components/ui'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { PrimaryActionButton, SecondaryActionMenu, TablePageLayout, OperationalSummary, CompactInfoNotice, StatusBadge } from '@/components/erp'
import { Fa, faBox, faBoxesStacked, faArrowDown, faBarcode, faTriangleExclamation, faWarehouse, faWrench, faPrint, faIndustry, faMagnifyingGlass } from '@/components/icons'
import { printProductLabels } from '@/lib/product-label'
import { printLabelsForSerialUnits } from '@/lib/inventory/print-serial-device-label'
import { guardSpreadsheetFile, guardSpreadsheetRows, SpreadsheetGuardError } from '@/lib/spreadsheet-guard'
import { Barcode } from '@/components/modules/Barcode'
import { inferTrackingMethod, isSerialTracking, isStockTracked, isSerialOnlyCategory, type TrackingMethod } from '@/lib/inventory-identifiers'
import { availableSellableQty, everStockedProductIds, isLowStockSku, onHandQtyAtStockLocations } from '@/lib/business-logic'
import { isStockOutMove } from '@/lib/kpi-stock'
import { unitSellingName } from '@/lib/reconfiguration/unit-selling-name'
import { catalogDeviceConfig, compactSpecsString, isReconfigurableCatalogCategory } from '@/lib/reconfiguration/unit-config'
import InventoryProductsPanel from '@/components/inventory/InventoryProductsPanel'
import InventoryViewBar from '@/components/inventory/InventoryViewBar'
import { useInventoryView } from '@/lib/inventory/use-inventory-view'
import {
  CATALOG_LAYOUTS,
  CATALOG_SHOW_OPTIONS,
  CATALOG_SORT_OPTIONS,
  DEFAULT_VIEW_PREFS,
  WAREHOUSE_SORT_OPTIONS,
  compareCatalog,
  matchesCatalogShow,
  matchesCondition,
  type CatalogShow,
  type CatalogSort,
  type WarehouseSort,
} from '@/lib/inventory/view-prefs'
import ProductPhotoFields, { uploadProductPhoto } from '@/components/inventory/ProductPhotoFields'
import ProductDuplicatesPanel from '@/components/inventory/ProductDuplicatesPanel'
import ComputerAidCustodyPanel from '@/components/inventory/ComputerAidCustodyPanel'
import VendorStockPanel from '@/components/inventory/VendorStockPanel'
import StockCheckoutPanel from '@/components/inventory/StockCheckoutPanel'
import PartsRequestsPanel from '@/components/inventory/PartsRequestsPanel'
import { canValidatePurchaseReceipt, canReleaseHeldSerial, canArchiveProduct } from '@/lib/inventory/permissions'
import type { ProductImageSlot } from '@/lib/product-images'
import { isOpeningStockMove } from '@/lib/inventory/opening-stock'
import { explainSerialWhereabouts, findSerialMatches } from '@/lib/inventory/serial-trace'
import { ScanInputRow } from '@/components/BarcodeScanner'
import { identityMatchesScan, parseScanPayload } from '@/lib/barcode-scan'
import { getCategoryMarkupPct, quoteSalePriceFromCost, autoSalePriceFromCost, suggestWholesalePriceFromCost } from '@/lib/sale-price-calculator'
import { reviewSalePrice } from '@/lib/pricing/latest-cost-review'
import { normalizePricingMarginPolicy } from '@/lib/pricing/margin-policy'
import { useUrlRecordId, useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'
import dynamic from 'next/dynamic'
import { applyCostBandPrices, blankProduct, buildProductBarcode, buildProductSku, normKey } from '@/lib/inventory/product-form-helpers'

export type ProductFormStart =
  | { mode: 'new'; name?: string }
  | { mode: 'edit'; product: Product }
  | { mode: 'variant'; parent: Product }

export default function ProductFormModal({
  start, onClose, onSaved, onEditing, onBulkImport, onDownloadTemplate, onArchivedRestored,
}: {
  start: ProductFormStart
  onClose: () => void
  /** The product just created or saved. */
  onSaved?: (product: Product) => void
  /** Which product is being edited (Inventory keeps it in the URL). */
  onEditing?: (productId: string | null) => void
  /** Inventory only: the bulk-upload shortcut at the top of a new product. */
  onBulkImport?: () => void
  onDownloadTemplate?: () => void
  /** Inventory only: an archived product was restored from the duplicate warning. */
  onArchivedRestored?: () => void
}) {
  const { products, addProduct, updateProduct, unarchiveProduct, showToast, accounts, systemSettings } = useInventoryStore()
  const emptyPhotoSlots = (): Record<ProductImageSlot, { url: string | null; source: 'upload' | 'catalog' | null; pending?: boolean }> => ({
    1: { url: null, source: null },
    2: { url: null, source: null },
  })
  const [form, setForm] = useState<any>(() => (start.mode === 'new' && start.name ? { ...blankProduct(), name: start.name } : blankProduct()))
  const [photoSlots, setPhotoSlots] = useState(emptyPhotoSlots)
  const [editId, setEditIdState] = useState<string | null>(start.mode === 'edit' ? start.product.id : null)
  const setEditId = (id: string | null) => { setEditIdState(id); onEditing?.(id) }
  const [dupConfirm, setDupConfirm] = useState(false)
  const [showAcctMapping, setShowAcctMapping] = useState(false)
  const [savingProduct, setSavingProduct] = useState(false)
  const setF = (key: string) => (value: any) => setForm((prev: any) => ({ ...prev, [key]: value }))

  // Live similar-name hint shown inside the product form while typing
  const nameSimilarProducts = useMemo(() => {
    if (!form.name || form.name.length < 3) return []
    const q = form.name.trim().toLowerCase()
    return products.filter(p => p.id !== editId && p.name.toLowerCase().includes(q)).slice(0, 3)
  }, [form.name, products, editId])

  const revenueAccounts = accounts.filter(a => a.type === 'revenue')
  const costAccounts = accounts.filter(a => a.type === 'expense')
  const assetAccounts = accounts.filter(a => a.type === 'asset')
  const inventoryExpenseAccounts = accounts.filter(a => a.type === 'expense')
  const acctOpt = (list: Account[]) => list.map(a => ({ value: a.code, label: `[${a.code}] ${a.name}` }))

  const loadProductPhotos = async (productId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/images`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(body.images)) return
      const next = emptyPhotoSlots()
      for (const image of body.images) {
        const slot = Number(image.slot) === 2 ? 2 : 1
        next[slot] = { url: image.url || null, source: image.source || null }
      }
      setPhotoSlots(next)
    } catch {
      setPhotoSlots(emptyPhotoSlots())
    }
  }

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
      salePrice: String(product.salePrice), costPrice: String(product.costPrice),
      wholesalePrice: Number(product.wholesalePrice) > 0 ? String(product.wholesalePrice) : '',
      commissionRatePercent: Number(product.commissionRatePercent) > 0 ? String(product.commissionRatePercent) : '',
      taxRate: String(product.taxRate),
      minStock: String(product.minStock),
      unit: product.unit || defaultUnitForKind(kind),
      invoicePolicy: product.invoicePolicy === 'delivery' ? 'delivery' as const : 'order' as const,
      pricingCategoryId: (product as any).pricingCategoryId ?? '',
      productType: (product as any).productType === 'new' ? 'new' : 'refurbished',
      description: product.description ?? '',
      canBeSold: product.canBeSold, canBePurchased: product.canBePurchased, image: product.image ?? '',
      isActive: product.isActive, warrantyMonths: String(product.warrantyMonths),
      saleAccountCode: product.saleAccountCode ?? '', costAccountCode: product.costAccountCode ?? '',
      inventoryAccountCode: product.inventoryAccountCode ?? '', cogsAccountCode: product.cogsAccountCode ?? '',
      adjustmentAccountCode: product.adjustmentAccountCode ?? '', writeOffAccountCode: product.writeOffAccountCode ?? '',
      priceDifferenceAccountCode: product.priceDifferenceAccountCode ?? '',
      parentId: product.parentId ?? '',
      deviceRamGb: product.deviceConfig && !catalogDeviceConfig(product.name, product.category)
        ? String(product.deviceConfig.totalRamGb || '')
        : '',
      deviceStorageGb: product.deviceConfig && !catalogDeviceConfig(product.name, product.category)
        ? String(product.deviceConfig.primaryStorageGb || '')
        : '',
    })
    setDupConfirm(false)
    setShowAcctMapping(!!(product.saleAccountCode || product.costAccountCode || product.inventoryAccountCode || product.cogsAccountCode))
    void loadProductPhotos(product.id)
  }

  const startVariant = (parent: Product) => {
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
  }

  const startEdit = (product: Product) => {
    fillProductForm(product)
    setEditId(product.id)
  }

  // Opened for an existing product or as a variant: fill the form once.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (start.mode === 'edit') fillProductForm(start.product)
    if (start.mode === 'variant') startVariant(start.parent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveProduct = async () => {
    if (!form.name.trim()) { showToast('Product name is required', 'error'); return }
    if (form.name.trim().length < 3) { showToast('Product name must be at least 3 characters', 'error'); return }
    {
      const isServiceForm = form.productKind === 'service' || form.category === 'Services'
      const isNum = (v: unknown) => String(v ?? '').trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
      const missing: string[] = []
      if (!form.category) missing.push('Category')
      if (!form.productKind) missing.push('Product Type')
      if (!isSerialOnlyCategory(form.category) && !form.trackingMethod) missing.push('Tracking Method')
      if (!form.unit) missing.push('Unit of Measure')
      if (form.productKind !== 'service' && !isNum(form.minStock)) missing.push('Min Stock')
      if (!isServiceForm && !form.productType) missing.push('Condition')
      if (String(form.taxRate ?? '').trim() === '') missing.push('VAT / Tax Rate')
      if (!isNum(form.warrantyMonths)) missing.push('Warranty (Months)')
      if (!form.invoicePolicy) missing.push('Invoicing Policy')
      if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    }

    // SKU is internal; generate one when omitted.
    const skuTrimmed = form.sku.trim() || buildProductSku(form.name, products)
    if (skuTrimmed) {
      const skuConflict = products.find(p => p.sku.toLowerCase() === skuTrimmed.toLowerCase() && p.id !== editId)
      if (skuConflict?.isActive) { showToast(`SKU "${skuTrimmed}" is already used by "${skuConflict.name}"`, 'error'); return }
      if (skuConflict && !skuConflict.isActive && !editId) {
        showToast(`SKU "${skuTrimmed}" belongs to archived “${skuConflict.name}”. Restore it from Products → Status: Archived.`, 'error')
        return
      }
    }

    // Hard block: barcode must be unique
    const barcodeTrimmed = form.barcode.trim()
    if (barcodeTrimmed) {
      const bcConflict = products.find(p => normKey(p.barcode) === normKey(barcodeTrimmed) && p.id !== editId)
      if (bcConflict?.isActive) { showToast(`Barcode "${barcodeTrimmed}" is already assigned to "${bcConflict.name}"`, 'error'); return }
      if (bcConflict && !bcConflict.isActive && !editId) {
        showToast(`Barcode "${barcodeTrimmed}" belongs to archived “${bcConflict.name}”. Restore it instead of creating a duplicate.`, 'error')
        return
      }
    }

    // Hard block exact product-master repetition. Use variants for alternate configurations.
    if (!editId && !form.parentId) {
      const nameConflict = products.find(p => p.name.trim().toLowerCase() === form.name.trim().toLowerCase())
      if (nameConflict?.isActive) { setDupConfirm(true); return }
      if (nameConflict && !nameConflict.isActive) {
        showToast(`“${nameConflict.name}” is archived. Restore it from Products → Status: Archived.`, 'error')
        return
      }
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
    const wholesalePrice = form.wholesalePrice === '' ? 0 : Number(form.wholesalePrice) || 0
    const commissionRatePercent = form.commissionRatePercent === '' ? null : Number(form.commissionRatePercent)
    if (salePrice < 0 || costPrice < 0 || wholesalePrice < 0) { showToast('Prices cannot be negative', 'error'); return }
    if (commissionRatePercent != null && (Number.isNaN(commissionRatePercent) || commissionRatePercent < 0 || commissionRatePercent > 100)) {
      showToast('Commission % must be between 0 and 100', 'error')
      return
    }
    const payload = {
      ...form,
      sku: skuTrimmed,
      barcode: productBarcode,
      parentId: form.parentId || undefined,
      pricingCategoryId: form.pricingCategoryId || undefined,
      productType: form.productType === 'new' ? 'new' : 'refurbished',
      salePrice, costPrice, wholesalePrice,
      commissionRatePercent,
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
      deviceRamGb: form.deviceRamGb === '' ? undefined : Number(form.deviceRamGb),
      deviceStorageGb: form.deviceStorageGb === '' ? undefined : Number(form.deviceStorageGb),
      image: photoSlots[1].url && !photoSlots[1].url.startsWith('data:')
        ? photoSlots[1].url
        : form.image,
    }
    if (editId) {
      updateProduct(editId, payload)
      const current = products.find(p => p.id === editId)
      if (current) onSaved?.({ ...current, ...payload } as Product)
      onClose()
      return
    }
    if (savingProduct) return
    setSavingProduct(true)
    try {
      const saved = await Promise.resolve(addProduct({ ...payload, isActive: true }))
      if (!saved) return
      const savedId = saved.id
      for (const slot of [1, 2] as ProductImageSlot[]) {
        const pending = photoSlots[slot]
        if (savedId && pending.pending && pending.url) {
          try {
            await uploadProductPhoto(savedId, slot, pending.url)
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Product saved, but a photo failed to upload', 'error')
          }
        }
      }
      onSaved?.(saved as Product)
      onClose()
    } finally {
      setSavingProduct(false)
    }
  }

        const parentProduct = form.parentId ? products.find((p: Product) => p.id === form.parentId) : null
        const exactDup = !editId && !form.parentId && products.find((p: Product) => p.isActive && p.name.trim().toLowerCase() === form.name.trim().toLowerCase())
        const archivedDup = !editId && !form.parentId && products.find((p: Product) => !p.isActive && p.name.trim().toLowerCase() === form.name.trim().toLowerCase())
        return (
        <Modal title={editId ? 'Edit Product Master' : form.parentId ? 'Create Product Variant' : 'Create New Product'} subtitle="Maintain product identity, category, pricing, stock controls and variants" onClose={onClose} width={920} variant="workspace">
          <div className="flex flex-col gap-5 pb-1">

            {!editId && !form.parentId && onBulkImport && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 rounded-xl border border-sky-100 bg-sky-50/80">
                <p className="text-[11px] text-sky-900">
                  Creating many products? Download the Excel template and bulk upload instead.
                </p>
                <div className="flex gap-2 shrink-0">
                  <button type="button" className="btn-secondary text-[10px] px-2.5 py-1" onClick={onDownloadTemplate}>
                    Download template
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-[10px] px-2.5 py-1"
                    onClick={() => { onClose(); onBulkImport?.() }}
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
                      onClick={() => startVariant(exactDup as Product)}>
                      Create Variant of existing
                    </button>
                  </div>
                </div>
              </div>
            )}

            {archivedDup && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--info-bg)]">
                <span className="text-lg mt-0.5 text-[var(--info-text)]" aria-hidden="true"><Fa icon={faTriangleExclamation} /></span>
                <div className="flex-1">
                  <p className="text-[12px] font-bold text-[var(--info-text)]">This product is archived</p>
                  <p className="text-[11px] text-text-2 mt-0.5">
                    <strong>&ldquo;{(archivedDup as Product).name}&rdquo;</strong> already exists and is hidden from sales and purchase pickers.
                    Restore it instead of creating a second entry.
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      type="button"
                      className="px-3 py-1 rounded-lg text-[11px] font-bold border border-[var(--border)] bg-white text-[var(--info-text)] hover:bg-[var(--primary-light)] transition-colors"
                      onClick={() => {
                        unarchiveProduct((archivedDup as Product).id)
                        onArchivedRestored?.()
                        startEdit({ ...(archivedDup as Product), isActive: true })
                      }}
                    >
                      Restore and edit
                    </button>
                  </div>
                </div>
              </div>
            )}

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="mb-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-[var(--navy)]">Product identity</p>
                <p className="text-[10px] text-[var(--text-3)] mt-0.5">Name, configuration, catalogue type and stock tracking.</p>
              </div>
              <div>
                <Field label="Product Name" required>
                  <Input value={form.name} onChange={(v: string) => { setF('name')(v); setDupConfirm(false) }} placeholder="e.g. HP ProBook 450 G9" />
                </Field>
                {isReconfigurableCatalogCategory(form.category) && (() => {
                  const detected = catalogDeviceConfig(form.name, form.category, {
                    totalRamGb: form.deviceRamGb === '' ? undefined : Number(form.deviceRamGb),
                    primaryStorageGb: form.deviceStorageGb === '' ? undefined : Number(form.deviceStorageGb),
                  })
                  return (
                    <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2">
                      {detected ? (
                        <p className="text-[11px] text-[var(--text-2)] m-0">
                          Detected for reconfiguration: {compactSpecsString(detected) || `${detected.totalRamGb}GB RAM`}
                        </p>
                      ) : (
                        <>
                          <p className="text-[11px] text-[var(--text-2)] m-0">
                            Name has no RAM/SSD. Optional — used when this SKU is a bare model.
                          </p>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <Field label="RAM (GB)">
                              <Input type="number" value={form.deviceRamGb} onChange={setF('deviceRamGb')} placeholder="e.g. 8" />
                            </Field>
                            <Field label="Storage (GB)">
                              <Input type="number" value={form.deviceStorageGb} onChange={setF('deviceStorageGb')} placeholder="e.g. 256" />
                            </Field>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })()}
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
                          <span className="truncate" title={`${p.name} ${p.sku}`}>
                            {p.name} <span className="text-text-4 font-mono">{p.sku}</span>
                            {!p.isActive && <span className="ml-1 text-[9px] font-black uppercase tracking-wider text-text-3">Archived</span>}
                          </span>
                        </span>
                        <div className="flex gap-1 shrink-0">
                          {p.isActive ? (
                            <>
                          <button className="px-2 py-0.5 rounded text-[9px] font-bold bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                            onClick={() => startVariant(p)}>+ Variant</button>
                          <button className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 transition-colors"
                            onClick={() => startEdit(p)}>Edit existing</button>
                            </>
                          ) : (
                          <button className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                            onClick={() => {
                              unarchiveProduct(p.id)
                              onArchivedRestored?.()
                              startEdit({ ...p, isActive: true })
                            }}>Restore</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Product Type" required>
                <Select
                  value={form.productKind || ''}
                  onChange={(value) => {
                    if (!value) { setF('productKind')(''); return }
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
                  options={[{ value: '', label: 'Select…' }, ...PRODUCT_KIND_OPTIONS.map(o => ({ value: o.value, label: o.label }))]}
                />
              </Field>
              <Field label="Category" required>
                <Select
                  value={form.category}
                  onChange={(value) => {
                    if (!value) {
                      setForm((prev: any) => ({ ...prev, category: '' }))
                      return
                    }
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
                    setForm((prev: any) => applyCostBandPrices({
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
                      }, systemSettings))
                  }}
                  options={[
                    { value: '', label: 'Select…' },
                    ...resolveProductCreationCategoryOptions((systemSettings as any).invProductCategories),
                    ...(
                      form.category &&
                      !resolveProductCreationCategoryOptions((systemSettings as any).invProductCategories).some(option => option.value === form.category)
                        ? [{ value: form.category, label: `Existing - ${form.category}` }]
                        : []
                    ),
                  ]}
                />
              </Field>
              <Field label="Tracking Method" required>
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
                          { value: '', label: 'Select…' },
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
              <Field label="Unit of Measure" required>
                <Select
                  value={form.unit || ''}
                  onChange={setF('unit')}
                  options={[{ value: '', label: 'Select…' }, ...UOM_OPTIONS.map(o => ({ value: o.value, label: o.label }))]}
                />
              </Field>
              <Field label="Barcode">
                <div className="flex gap-2">
                  <Input value={form.barcode} onChange={setF('barcode')} placeholder="Optional product barcode" />
                  <button type="button" className="btn-secondary px-3 text-[11px] whitespace-nowrap" onClick={() => setF('barcode')(buildProductBarcode(form.sku || form.name, form.name, products, editId || undefined))}>Generate</button>
                </div>
              </Field>
              <Field label="Min Stock" required={form.productKind !== 'service'}>
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
              {editId && (
              <label className="flex items-center gap-2 text-[12px] font-semibold text-text-2 cursor-pointer" title="Inactive products are archived — hidden from sales/purchase pickers">
                <input type="checkbox" checked={!!form.isActive} onChange={e => setF('isActive')(e.target.checked)} />
                Active (uncheck to archive)
              </label>
              )}
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
            {form.productKind !== 'service' && form.category !== 'Services' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Condition" required hint="Printed on labels · selects New vs Refurb pricing band">
                  <Select
                    value={form.productType || ''}
                    onChange={v => {
                      setForm((prev: any) => applyCostBandPrices({ ...prev, productType: v }, systemSettings))
                    }}
                    options={[
                      { value: '', label: 'Select…' },
                      { value: 'refurbished', label: 'Refurbished' },
                      { value: 'new', label: 'Brand new' },
                    ]}
                  />
                </Field>
                <Field label="Pricing band">
                  <Select
                    value={form.pricingCategoryId || ''}
                    onChange={v => {
                      setForm((prev: any) => applyCostBandPrices({ ...prev, pricingCategoryId: v }, systemSettings))
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
              </div>
            )}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="mb-3">
                <p className="text-[11px] font-black uppercase tracking-wider text-[var(--navy)]">Pricing and tax</p>
                <p className="text-[10px] text-[var(--text-3)] mt-0.5">Select the VAT rate explicitly — 16% only when VAT applies.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Cost Price" hint="Sale and wholesale update from cost">
                <Input
                  type="number"
                  value={form.costPrice}
                  onChange={v => {
                    setForm((prev: any) => applyCostBandPrices({ ...prev, costPrice: v }, systemSettings))
                  }}
                />
              </Field>
              <Field label="Sale Price" hint="Walk-in / quotation list (max band)">
                <Input type="number" value={form.salePrice} onChange={setF('salePrice')} />
              </Field>
              <Field label="Wholesale / reseller" hint="Partner API price. Blank uses min GP band">
                <Input
                  type="number"
                  value={form.wholesalePrice}
                  onChange={setF('wholesalePrice')}
                  placeholder={(() => {
                    const quote = quoteSalePriceFromCost({
                      costPrice: form.costPrice,
                      erpCategory: form.category,
                      pricingCategoryId: form.pricingCategoryId,
                      productType: form.productType,
                      policy: systemSettings.pricingMarginPolicy,
                      legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
                    })
                    return quote.ok ? String(quote.min.sellExVatRounded) : ''
                  })()}
                />
              </Field>
              <Field label="VAT / Tax Rate" required hint="Select 16% only when VAT applies.">
                <Select
                  value={String(form.taxRate ?? '')}
                  onChange={setF('taxRate')}
                  options={[
                    ...(['', '0', '16'].includes(String(form.taxRate ?? '')) ? [] : [{ value: String(form.taxRate), label: `${form.taxRate}%` }]),
                    { value: '', label: 'Select…' },
                    { value: '0', label: '0% — No VAT' },
                    { value: '16', label: '16% — VAT' },
                  ]}
                />
              </Field>
              <Field label="Commission %" hint="Blank uses the category rate from Settings → Sales">
                <Input type="number" value={form.commissionRatePercent} onChange={setF('commissionRatePercent')} placeholder="Category default" />
              </Field>
              </div>
            </section>
            {form.productKind !== 'service' && form.category !== 'Services' && (() => {
              const quote = quoteSalePriceFromCost({
                costPrice: form.costPrice,
                erpCategory: form.category,
                pricingCategoryId: form.pricingCategoryId,
                productType: form.productType,
                policy: systemSettings.pricingMarginPolicy,
                legacyMarkupMap: systemSettings.invCategorySaleMarkupPct,
              })
              if (quote.ok) {
                return (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--info-bg)] px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <p className="text-[11px] text-[var(--navy)] leading-relaxed m-0">
                      <strong>{quote.category.name}</strong>: quote {fmtKes(quote.min.sellExVatRounded)}-{fmtKes(quote.max.sellExVatRounded)} ex VAT
                      {' '}(invoice ~{fmtKes(Math.round(quote.min.invoiceIncVat))}-{fmtKes(Math.round(quote.max.invoiceIncVat))} inc VAT).
                      Overhead {quote.overheadRatePct.toFixed(1)}%{quote.tierReductionPct ? `, tier -${quote.tierReductionPct}%` : ''}.
                      List/sale = max. Reseller (Partner API) = min unless wholesale is saved.
                    </p>
                    <div className="flex gap-2 flex-shrink-0">
                      <button type="button" className="btn-secondary text-[11px] px-3 py-1.5" onClick={() => setF('salePrice')(String(quote.min.sellExVatRounded))}>Sale min</button>
                      <button type="button" className="btn-secondary text-[11px] px-3 py-1.5" onClick={() => setF('salePrice')(String(quote.max.sellExVatRounded))}>Sale max</button>
                      <button type="button" className="btn-secondary text-[11px] px-3 py-1.5" onClick={() => setF('wholesalePrice')(String(quote.min.sellExVatRounded))}>Reseller min</button>
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
            <Field label="Warranty (Months)" required><Input type="number" value={form.warrantyMonths} onChange={setF('warrantyMonths')} /></Field>
            <ProductPhotoFields
              productId={editId}
              slots={photoSlots}
              onSlotsChange={setPhotoSlots}
              onToast={showToast}
            />
            <Field label="Invoicing Policy" required>
              <Select value={form.invoicePolicy} onChange={setF('invoicePolicy')} options={[
                { value: '', label: 'Select…' },
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

            <div className="sticky bottom-0 z-20 -mx-1 mt-1 flex flex-col-reverse gap-3 border-t border-[var(--border)] bg-[var(--bg-card)] px-1 pb-1 pt-4 sm:flex-row sm:justify-end">
              <button className="btn-secondary w-full px-6 sm:w-auto" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary w-full px-8 sm:w-auto"
                onClick={() => { void saveProduct() }}
                disabled={savingProduct || (dupConfirm && !!exactDup) || !!archivedDup}
              >
                {archivedDup ? 'Restore archived product above' : dupConfirm && exactDup ? 'Resolve duplicate above' : savingProduct ? 'Saving…' : 'Save Product'}
              </button>
            </div>
          </div>
        </Modal>
        )
}
