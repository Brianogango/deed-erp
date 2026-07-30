'use client'

import React, { useMemo, useState } from 'react'
import {
  useInventoryStore,
  Product,
  LOCATIONS,
  LocationId,
  ALL_CATEGORIES,
  fmtKes,
  SerialNumber,
} from '@/lib/store'
import { DataTable, type ColumnDef, type PrimaryFilterConfig, type ActiveFilterChip } from '@/components/data-table'
import { CompactInfoNotice, TablePageLayout } from '@/components/erp'
import { Fa } from '@/components/icons'
import { faPrint } from '@fortawesome/free-solid-svg-icons'
import { printProductLabels, printSerialLabels } from '@/lib/product-label'
import { downloadProductLabelsPdf, downloadSerialLabelsPdf } from '@/lib/inventory/label-pdf'
import {
  EMPTY_PRODUCT_FILTERS,
  activeFilterChips,
  collectVendorProductIds,
  getProductQtySnapshot,
  productMatchesFilters,
  type ProductFilterState,
} from '@/lib/inventory/product-filters'
import { canEditSerialNumber, canPrintInventoryLabels } from '@/lib/inventory/permissions'
import { inferTrackingMethod, isSerialTracking, type TrackingMethod } from '@/lib/inventory-identifiers'
import SerialManageDrawer from './SerialManageDrawer'

type ProductListRow = {
  id: string
  product: Product
  kind: 'standalone' | 'parent' | 'variant'
  variants?: Product[]
  isExpanded?: boolean
  onHand: number
  available: number
  reserved: number
  refurbishment: number
  underRepair: number
  held: number
}

interface InventoryProductsPanelProps {
  onEdit: (product: Product) => void
  onCreateVariant: (product: Product) => void
  orphanedVariantIds: Set<string>
  onDownloadTemplate?: () => void
  onImportProducts?: () => void
  canImportProducts?: boolean
}

export default function InventoryProductsPanel({
  onEdit,
  onCreateVariant,
  orphanedVariantIds,
  onDownloadTemplate,
  onImportProducts,
  canImportProducts = false,
}: InventoryProductsPanelProps) {
  const {
    products, serials, bulkStock, receipts, purchaseOrders, contacts,
    currentUserId, users, addAuditLog, showToast,
  } = useInventoryStore()
  const role = users.find(u => u.id === currentUserId)?.role
  const canLabels = canPrintInventoryLabels(role)
  const canEditSerial = canEditSerialNumber(role)

  const [filters, setFilters] = useState<ProductFilterState>(EMPTY_PRODUCT_FILTERS)
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const [serialProduct, setSerialProduct] = useState<Product | null>(null)
  const [labelBusy, setLabelBusy] = useState(false)

  const vendorOptions = useMemo(() => {
    const vendors = contacts.filter(c => c.isVendor)
    const fromPo = purchaseOrders.map(po => ({ id: po.vendorId, name: po.vendorName }))
    const map = new Map<string, string>()
    for (const v of vendors) map.set(v.id, v.name)
    for (const v of fromPo) if (v.id && v.name) map.set(v.id, v.name)
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [contacts, purchaseOrders])

  const vendorProductIds = useMemo(
    () => collectVendorProductIds({
      vendorId: filters.vendorId,
      serials,
      receipts,
      purchaseOrders,
    }),
    [filters.vendorId, serials, receipts, purchaseOrders],
  )

  const qtyByProduct = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getProductQtySnapshot>>()
    for (const p of products) {
      map.set(p.id, getProductQtySnapshot(p, serials, bulkStock, filters.warehouse))
    }
    return map
  }, [products, serials, bulkStock, filters.warehouse])

  const filteredProducts = useMemo(
    () => products.filter(p => productMatchesFilters({
      product: p,
      filters,
      qty: qtyByProduct.get(p.id) || { onHand: 0, available: 0, reserved: 0, refurbishment: 0, underRepair: 0, held: 0, byLocation: {
        warehouse: 0, shop: 0, repair_unit: 0, vendor: 0, customer: 0, employee: 0,
      } },
      serials,
      vendorProductIds: filters.vendorId === 'all' ? undefined : vendorProductIds,
    })),
    [products, filters, qtyByProduct, serials, vendorProductIds],
  )

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

  const rows = useMemo(() => {
    const list: ProductListRow[] = []
    for (const { product, variants } of productGroups) {
      const qty = qtyByProduct.get(product.id)!
      if (variants.length === 0) {
        list.push({
          id: product.id,
          product,
          kind: 'standalone',
          onHand: qty.onHand,
          available: qty.available,
          reserved: qty.reserved,
          refurbishment: qty.refurbishment,
          underRepair: qty.underRepair,
          held: qty.held,
        })
        continue
      }
      const isExpanded = !collapsedParents.has(product.id)
      const variantQty = variants.reduce(
        (acc, v) => {
          const q = qtyByProduct.get(v.id)!
          return {
            onHand: acc.onHand + q.onHand,
            available: acc.available + q.available,
            reserved: acc.reserved + q.reserved,
            refurbishment: acc.refurbishment + q.refurbishment,
            underRepair: acc.underRepair + q.underRepair,
            held: acc.held + q.held,
          }
        },
        {
          onHand: qty.onHand,
          available: qty.available,
          reserved: qty.reserved,
          refurbishment: qty.refurbishment,
          underRepair: qty.underRepair,
          held: qty.held,
        },
      )
      list.push({
        id: product.id,
        product,
        kind: 'parent',
        variants,
        isExpanded,
        ...variantQty,
      })
      if (isExpanded) {
        for (const v of variants) {
          const q = qtyByProduct.get(v.id)!
          list.push({
            id: v.id,
            product: v,
            kind: 'variant',
            onHand: q.onHand,
            available: q.available,
            reserved: q.reserved,
            refurbishment: q.refurbishment,
            underRepair: q.underRepair,
            held: q.held,
          })
        }
      }
    }
    return list
  }, [productGroups, collapsedParents, qtyByProduct])

  const setFilter = <K extends keyof ProductFilterState>(key: K, value: ProductFilterState[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearFilters = () => setFilters(EMPTY_PRODUCT_FILTERS)

  const chips: ActiveFilterChip[] = useMemo(() => {
    const vendorName = vendorOptions.find(v => v.id === filters.vendorId)?.name
    return activeFilterChips(filters, vendorName).map(chip => ({
      ...chip,
      onRemove: () => {
        if (chip.key === 'warehouse') setFilter('warehouse', 'all')
        else if (chip.key === 'vendor') setFilter('vendorId', 'all')
        else if (chip.key === 'category') setFilter('category', 'All')
        else if (chip.key === 'productType') setFilter('productType', 'all')
        else if (chip.key === 'tracking') setFilter('tracking', 'all')
        else if (chip.key === 'reorder') setFilter('reorder', 'all')
        else if (chip.key === 'stockAvailability') setFilter('stockAvailability', 'all')
        else if (chip.key === 'onHandQty') {
          setFilters(prev => ({ ...prev, onHandQty: 'all', onHandMin: '', onHandMax: '' }))
        } else if (chip.key === 'includeArchived') setFilter('includeArchived', false)
      },
    }))
  }, [filters, vendorOptions])

  const primaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'warehouse',
      label: 'Warehouse',
      placeholder: 'All warehouses',
      value: filters.warehouse,
      allValue: 'all',
      options: [
        { value: 'all', label: 'All warehouses' },
        ...(['warehouse', 'shop', 'repair_unit'] as LocationId[]).map(id => ({
          value: id,
          label: LOCATIONS[id].name,
        })),
      ],
      onChange: v => setFilter('warehouse', v as LocationId | 'all'),
    },
    {
      key: 'vendor',
      label: 'Vendor',
      placeholder: 'All vendors',
      value: filters.vendorId,
      allValue: 'all',
      options: [
        { value: 'all', label: 'All vendors' },
        ...vendorOptions.map(v => ({ value: v.id, label: v.name })),
      ],
      onChange: v => setFilter('vendorId', v),
    },
  ]

  const advancedFilters = (
    <div className="flex flex-col gap-3">
      <label className="dt-sheet-field">
        <span className="dt-sheet-label">Category</span>
        <select
          className="dt-toolbar-select w-full"
          value={filters.category}
          onChange={e => setFilter('category', e.target.value)}
        >
          <option value="All">All categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="dt-sheet-field">
        <span className="dt-sheet-label">Product type</span>
        <select
          className="dt-toolbar-select w-full"
          value={filters.productType}
          onChange={e => setFilter('productType', e.target.value as ProductFilterState['productType'])}
        >
          <option value="all">All types</option>
          <option value="storable">Storable product</option>
          <option value="consumable">Consumable</option>
          <option value="service">Service</option>
          <option value="stockable">Any stock-tracked</option>
        </select>
      </label>
      <label className="dt-sheet-field">
        <span className="dt-sheet-label">Tracking</span>
        <select
          className="dt-toolbar-select w-full"
          value={filters.tracking}
          onChange={e => setFilter('tracking', e.target.value as TrackingMethod | 'all')}
        >
          <option value="all">All tracking methods</option>
          <option value="NONE">No tracking</option>
          <option value="QUANTITY">By quantity</option>
          <option value="BATCH">By lot / batch</option>
          <option value="SERIAL">By serial number</option>
        </select>
      </label>
      <label className="dt-sheet-field">
        <span className="dt-sheet-label">Reorder</span>
        <select
          className="dt-toolbar-select w-full"
          value={filters.reorder}
          onChange={e => setFilter('reorder', e.target.value as ProductFilterState['reorder'])}
        >
          <option value="all">All reorder states</option>
          <option value="enabled">Reorder enabled</option>
          <option value="disabled">Reorder disabled</option>
          <option value="below_level">Below reorder level</option>
          <option value="required">Reorder required</option>
        </select>
      </label>
      <label className="dt-sheet-field">
        <span className="dt-sheet-label">Stock availability</span>
        <select
          className="dt-toolbar-select w-full"
          value={filters.stockAvailability}
          onChange={e => setFilter('stockAvailability', e.target.value as ProductFilterState['stockAvailability'])}
        >
          <option value="all">All stock states</option>
          <option value="in_stock">In stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="low_stock">Low stock</option>
          <option value="reserved">Held (not free to sell)</option>
          <option value="negative">Negative stock</option>
        </select>
      </label>
      <label className="dt-sheet-field">
        <span className="dt-sheet-label">On-hand quantity</span>
        <select
          className="dt-toolbar-select w-full"
          value={filters.onHandQty}
          onChange={e => setFilter('onHandQty', e.target.value as ProductFilterState['onHandQty'])}
        >
          <option value="all">Any quantity</option>
          <option value="gt_zero">Greater than zero</option>
          <option value="eq_zero">Equal to zero</option>
          <option value="range">Custom range</option>
        </select>
      </label>
      {filters.onHandQty === 'range' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="dt-sheet-field">
            <span className="dt-sheet-label">Minimum</span>
            <input
              className="form-input w-full"
              type="number"
              value={filters.onHandMin}
              onChange={e => setFilter('onHandMin', e.target.value)}
            />
          </label>
          <label className="dt-sheet-field">
            <span className="dt-sheet-label">Maximum</span>
            <input
              className="form-input w-full"
              type="number"
              value={filters.onHandMax}
              onChange={e => setFilter('onHandMax', e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
        <input
          type="checkbox"
          checked={filters.includeArchived}
          onChange={e => setFilter('includeArchived', e.target.checked)}
        />
        Include archived products
      </label>
    </div>
  )

  const columns: ColumnDef<ProductListRow>[] = [
    {
      key: 'product',
      label: 'Product details',
      priority: 1,
      width: 'minmax(14rem, 2fr)',
      render: row => {
        const { product, kind, variants = [], isExpanded } = row
        return (
          <div className={`min-w-0 ${kind === 'variant' ? 'pl-4' : ''}`}>
            <div className="flex items-center gap-2">
              {kind === 'parent' && <span className="text-[10px] text-text-3">{isExpanded ? '▾' : '▸'}</span>}
              <span className="text-xs font-bold text-text-1 erp-truncate" title={product.name}>{product.name}</span>
            </div>
            <div className="text-[10px] text-text-3 font-mono erp-truncate">
              SKU: {product.sku || '—'}
              {product.barcode ? ` · Barcode: ${product.barcode}` : ''}
            </div>
            {kind === 'parent' && (
              <div className="text-[9px] text-text-4 mt-0.5">{variants.length} variant{variants.length === 1 ? '' : 's'}</div>
            )}
            {orphanedVariantIds.has(product.id) && (
              <div className="text-[9px] text-orange-600 font-bold mt-0.5">Orphaned variant</div>
            )}
          </div>
        )
      },
      accessor: row => `${row.product.name} ${row.product.sku} ${row.product.barcode ?? ''}`,
      exportValue: row => row.product.name,
    },
    {
      key: 'category',
      label: 'Category',
      priority: 2,
      width: '120px',
      render: row => <span className="text-xs text-text-3 erp-truncate">{row.product.category}</span>,
      exportValue: row => row.product.category,
    },
    {
      key: 'type',
      label: 'Type',
      priority: 2,
      width: '110px',
      render: row => {
        const tracking = inferTrackingMethod(row.product)
        return <span className="text-xs text-text-2">{tracking === 'NONE' ? 'Service' : 'Stockable'}</span>
      },
      exportValue: row => (inferTrackingMethod(row.product) === 'NONE' ? 'Service' : 'Stockable'),
    },
    {
      key: 'tracking',
      label: 'Tracking',
      priority: 2,
      width: '100px',
      render: row => <span className="text-xs font-mono text-text-2">{inferTrackingMethod(row.product)}</span>,
      exportValue: row => inferTrackingMethod(row.product),
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      priority: 2,
      width: '120px',
      render: () => (
        <span className="text-xs text-text-3">
          {filters.warehouse === 'all' ? 'All warehouses' : LOCATIONS[filters.warehouse].name}
        </span>
      ),
      exportValue: () => (filters.warehouse === 'all' ? 'All warehouses' : LOCATIONS[filters.warehouse].name),
    },
    {
      key: 'onHand',
      label: 'On hand',
      priority: 1,
      width: '90px',
      render: row => {
        const tracking = inferTrackingMethod(row.product)
        if (tracking === 'NONE') return <span className="text-xs text-text-4">N/A</span>
        return (
          <span
            className="text-xs font-bold text-text-1"
            title="Units physically in warehouse / shop / repair (includes held units)"
          >
            {row.onHand}
          </span>
        )
      },
      exportValue: row => (inferTrackingMethod(row.product) === 'NONE' ? 'N/A' : row.onHand),
    },
    {
      key: 'available',
      label: 'Available',
      priority: 3,
      width: '90px',
      render: row => {
        const tracking = inferTrackingMethod(row.product)
        if (tracking === 'NONE') return <span className="text-xs text-text-4">—</span>
        return (
          <span
            className="text-xs text-text-2"
            title="Free to sell (status available only)"
          >
            {row.available}
          </span>
        )
      },
      exportValue: row => row.available,
    },
    {
      key: 'held',
      label: 'Held',
      priority: 3,
      width: '100px',
      render: row => {
        const tracking = inferTrackingMethod(row.product)
        if (tracking === 'NONE') return <span className="text-xs text-text-4">—</span>
        if (row.held <= 0) return <span className="text-xs text-text-4">0</span>
        const parts = [
          row.reserved ? `${row.reserved} assigned (SO/repair)` : '',
          row.refurbishment ? `${row.refurbishment} refurb` : '',
          row.underRepair ? `${row.underRepair} under repair` : '',
        ].filter(Boolean)
        return (
          <span
            className="text-xs font-bold text-amber-700"
            title={parts.length ? parts.join(' · ') : 'On hand but not free to sell'}
          >
            {row.held}
          </span>
        )
      },
      exportValue: row => row.held,
    },
    {
      key: 'reorder',
      label: 'Reorder',
      priority: 3,
      width: '100px',
      render: row => {
        const min = row.product.minStock
        if (!min) return <span className="text-xs text-text-4">—</span>
        const below = row.onHand < min
        return (
          <span className={`text-xs font-bold ${below ? 'text-amber-700' : 'text-text-2'}`}>
            {below ? `Below ${min}` : `Min ${min}`}
          </span>
        )
      },
      exportValue: row => row.product.minStock || '',
    },
  ]

  const productSerialCount = (productId: string) =>
    serials.filter(s => s.productId === productId).length

  const runProductLabels = async (selected: ProductListRow[], mode: 'print' | 'pdf') => {
    if (!canLabels) {
      showToast('You do not have permission to print labels', 'error')
      return
    }
    if (!selected.length) return
    setLabelBusy(true)
    try {
      if (mode === 'print') {
        for (const row of selected) printProductLabels(row.product, 1)
      } else {
        const filename = await downloadProductLabelsPdf(
          selected.map(row => ({
            name: row.product.name,
            sku: row.product.sku,
            barcode: row.product.barcode,
            salePrice: row.product.salePrice,
            category: row.product.category,
          })),
        )
        addAuditLog('labels_download', filename, `Downloaded ${selected.length} product label(s) as PDF`)
        showToast(`Downloaded ${filename}`, 'success')
      }
      addAuditLog(
        mode === 'print' ? 'labels_print' : 'labels_download',
        'inventory-products',
        `${mode} ${selected.length} product label(s)`,
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Label action failed', 'error')
    } finally {
      setLabelBusy(false)
    }
  }

  return (
    <>
      <TablePageLayout
        title="Products"
        notice={
          <CompactInfoNotice>
            On hand = warehouse/shop/repair including held units. Available = free to sell only. Held = reserved (SO pick), refurb, under repair.
            Open Serials for Sold / Reserved filters, or Inventory → Reports → Find Serial to trace a unit (e.g. PF1CX9NP).
          </CompactInfoNotice>
        }
      >
        <DataTable
          tableId="inventory-products"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          searchValue={filters.search}
          onSearchChange={v => setFilter('search', v)}
          searchPlaceholder="Search product, SKU, barcode or serial…"
          clientSearch={false}
          primaryFilters={primaryFilters}
          advancedFilters={advancedFilters}
          activeFilters={chips}
          onClearFilters={clearFilters}
          hideColumnFilters
          emptyMessage="No products match the current filters"
          exportTitle="Product Master"
          exportFilename="inventory-products"
          perPage={20}
          selectable
          overflowActions={[
            ...(canImportProducts && onDownloadTemplate ? [{
              id: 'product-template',
              label: 'Download product template',
              onSelect: onDownloadTemplate,
            }] : []),
            ...(canImportProducts && onImportProducts ? [{
              id: 'product-import',
              label: 'Import products (bulk)',
              onSelect: onImportProducts,
            }] : []),
            ...(canLabels ? [{
              id: 'labels-print-page',
              label: labelBusy ? 'Preparing labels…' : 'Print labels (selected via bulk bar)',
              onSelect: () => showToast('Select products, then use the bulk Labels actions', 'info'),
            }] : []),
          ]}
          bulkActions={({ rows: selected, clear }) => (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-text-2">{selected.length} selected</span>
              {canLabels && (
                <>
                  <button
                    type="button"
                    className="dt-toolbar-btn"
                    disabled={labelBusy}
                    onClick={() => { void runProductLabels(selected, 'print') }}
                  >
                    <Fa icon={faPrint} className="dt-toolbar-icon" /> Print labels
                  </button>
                  <button
                    type="button"
                    className="dt-toolbar-btn"
                    disabled={labelBusy}
                    onClick={() => { void runProductLabels(selected, 'pdf') }}
                  >
                    Download labels PDF
                  </button>
                </>
              )}
              <button type="button" className="dt-toolbar-btn" onClick={clear}>Clear</button>
            </div>
          )}
          rowActions={row => {
            const tracking = inferTrackingMethod(row.product)
            const serialCount = isSerialTracking(tracking) ? productSerialCount(row.product.id) : 0
            return (
              <div className="flex justify-end gap-1.5">
                {isSerialTracking(tracking) && (
                  <button
                    type="button"
                    className="px-2 py-1.5 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 text-[10px] font-extrabold"
                    onClick={() => setSerialProduct(row.product)}
                    title="View serials"
                  >
                    Serials: {serialCount}
                  </button>
                )}
                {canLabels && (
                  <button
                    type="button"
                    className="px-2 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 text-[10px] font-extrabold"
                    onClick={() => printProductLabels(row.product, 1)}
                    title="Print product label"
                  >
                    <Fa icon={faPrint} className="text-[9px]" />
                  </button>
                )}
                {row.kind !== 'variant' && (
                  <button
                    type="button"
                    className="px-2 py-1.5 rounded-lg text-[10px] font-extrabold border"
                    style={{ background: 'var(--info-bg)', color: '#4338CA', borderColor: '#C7D2FE' }}
                    onClick={() => onCreateVariant(row.product)}
                  >
                    + Variant
                  </button>
                )}
                <button
                  type="button"
                  className="px-2.5 py-1.5 rounded-lg bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-extrabold"
                  onClick={() => onEdit(row.product)}
                >
                  Edit
                </button>
              </div>
            )
          }}
          rowClassName={row => (row.kind === 'variant' ? 'bg-[var(--bg-surface)]' : '')}
          onRowClick={row => {
            if (row.kind !== 'parent') return
            setCollapsedParents(prev => {
              const next = new Set(prev)
              next.has(row.product.id) ? next.delete(row.product.id) : next.add(row.product.id)
              return next
            })
          }}
        />
      </TablePageLayout>

      {serialProduct && (
        <SerialManageDrawer
          product={serialProduct}
          serials={serials.filter(s => s.productId === serialProduct.id) as SerialNumber[]}
          canEdit={canEditSerial}
          warehouseFilter={filters.warehouse}
          onClose={() => setSerialProduct(null)}
          onPrintSerials={async items => {
            await printSerialLabels(items)
            addAuditLog('labels_print', serialProduct.sku, `Printed ${items.length} serial label(s)`)
          }}
          onDownloadSerials={async items => {
            const filename = await downloadSerialLabelsPdf(items)
            addAuditLog('labels_download', filename, `Downloaded ${items.length} serial label(s)`)
            showToast(`Downloaded ${filename}`, 'success')
            return filename
          }}
        />
      )}
    </>
  )
}
