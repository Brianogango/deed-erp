'use client'

import React, { useMemo, useState } from 'react'
import {
  useInventoryStore,
  LOCATIONS,
  LocationId,
} from '@/lib/store'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { CompactInfoNotice, OperationalSummary, TablePageLayout } from '@/components/erp'
import { exportToExcel, exportToPDF } from '@/lib/export-utils'
import {
  buildVendorLedgerRows,
  downloadVendorLedgerCsv,
  vendorLedgerExportMatrix,
  type VendorLedgerRow,
  type VendorLedgerSoldFilter,
} from '@/lib/inventory/vendor-ledger'
import { canViewPurchaseCost, canViewVendorLedger } from '@/lib/inventory/permissions'

export default function VendorInventoryLedger() {
  const {
    products, serials, receipts, purchaseOrders, contacts,
    purchaseReturns, returnOrders, currentUserId, users, showToast, addAuditLog,
  } = useInventoryStore()

  const role = users.find(u => u.id === currentUserId)?.role
  const allowed = canViewVendorLedger(role)
  const showCost = canViewPurchaseCost(role)

  const [vendorId, setVendorId] = useState('all')
  const [warehouse, setWarehouse] = useState<LocationId | 'all'>('all')
  const [soldFilter, setSoldFilter] = useState<VendorLedgerSoldFilter>('all')
  const [search, setSearch] = useState('')

  const vendorOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of contacts.filter(c => c.isVendor)) map.set(c.id, c.name)
    for (const po of purchaseOrders) if (po.vendorId) map.set(po.vendorId, po.vendorName)
    for (const r of receipts) if (r.vendorId) map.set(r.vendorId, r.vendorName)
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [contacts, purchaseOrders, receipts])

  const { rows, summary } = useMemo(() => {
    if (vendorId === 'all') {
      return {
        rows: [] as VendorLedgerRow[],
        summary: {
          unitsReceived: 0, unitsSold: 0, unitsInStock: 0, unitsReturned: 0,
          serialisedUnits: 0, quantityTrackedUnits: 0,
        },
      }
    }
    return buildVendorLedgerRows({
      vendorId,
      serials,
      receipts,
      purchaseOrders,
      products,
      customerReturns: returnOrders,
      vendorReturns: purchaseReturns,
      warehouse,
      soldFilter,
      search,
    })
  }, [vendorId, serials, receipts, purchaseOrders, products, returnOrders, purchaseReturns, warehouse, soldFilter, search])

  const vendorName = vendorOptions.find(v => v.id === vendorId)?.name || vendorId

  const columns: ColumnDef<VendorLedgerRow>[] = [
    {
      key: 'product', label: 'Product', priority: 1, width: 'minmax(12rem, 1.6fr)',
      render: row => (
        <div className="min-w-0">
          <div className="text-xs font-bold text-text-1 erp-truncate">{row.productName}</div>
          <div className="text-[10px] text-text-3 font-mono">SKU: {row.sku || '—'}</div>
        </div>
      ),
      exportValue: row => row.productName,
    },
    {
      key: 'serial', label: 'Serial / lot', priority: 1, width: '140px',
      render: row => <span className="text-xs font-mono">{row.serial || row.lotOrLayer || '—'}</span>,
      exportValue: row => row.serial || row.lotOrLayer || '',
    },
    {
      key: 'received', label: 'Received', priority: 2, width: '110px',
      render: row => <span className="text-xs text-text-3">{row.receivedDate || '—'}</span>,
      exportValue: row => row.receivedDate || '',
    },
    {
      key: 'refs', label: 'PO / Receipt', priority: 3, width: '140px',
      render: row => (
        <div className="text-[10px] font-mono text-text-3">
          <div>{row.purchaseOrderRef || '—'}</div>
          <div>{row.receiptRef || '—'}</div>
        </div>
      ),
      exportValue: row => `${row.purchaseOrderRef || ''} / ${row.receiptRef || ''}`,
    },
    {
      key: 'warehouse', label: 'Warehouse', priority: 2, width: '110px',
      render: row => (
        <span className="text-xs">
          {row.warehouse === 'all' ? 'All' : (LOCATIONS[row.warehouse as LocationId]?.name || row.warehouse)}
        </span>
      ),
      exportValue: row => row.warehouse,
    },
    {
      key: 'qty', label: 'Qty', priority: 2, width: '90px',
      render: row => (
        <span className="text-xs">
          {row.quantityPurchased}
          {row.kind === 'quantity' ? ` · rem ${row.quantityRemaining}` : ''}
        </span>
      ),
      exportValue: row => row.quantityPurchased,
    },
    {
      key: 'salesStatus', label: 'Sales status', priority: 2, width: '100px',
      render: row => <span className="text-xs">{row.salesStatus}</span>,
      exportValue: row => row.salesStatus,
    },
    {
      key: 'soldDate', label: 'Sold date', priority: 3, width: '100px',
      render: row => <span className="text-xs text-text-3">{row.soldDate || '—'}</span>,
      exportValue: row => row.soldDate || '',
    },
    {
      key: 'returnStatus', label: 'Return status', priority: 1, width: '130px',
      render: row => <span className="text-xs font-semibold">{row.returnStatus}</span>,
      exportValue: row => row.returnStatus,
    },
    {
      key: 'returnDate', label: 'Return date', priority: 3, width: '100px',
      render: row => <span className="text-xs text-text-3">{row.returnDate || '—'}</span>,
      exportValue: row => row.returnDate || '',
    },
    {
      key: 'returnRef', label: 'Return ref', priority: 3, width: '110px',
      render: row => <span className="text-[10px] font-mono text-text-3">{row.returnRef || '—'}</span>,
      exportValue: row => row.returnRef || '',
    },
    {
      key: 'days', label: 'Days in stock', priority: 3, width: '90px',
      render: row => <span className="text-xs">{row.daysInStock ?? '—'}</span>,
      exportValue: row => row.daysInStock ?? '',
    },
  ]

  const exportRows = () => {
    const { headers, data } = vendorLedgerExportMatrix(rows)
    return { headers, data }
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const baseName = `vendor-inventory-ledger-${(vendorName || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}`

  if (!allowed) {
    return (
      <div className="p-4 text-sm text-text-3">
        You do not have permission to view the vendor inventory ledger.
      </div>
    )
  }

  return (
    <TablePageLayout
      title={vendorId === 'all' ? 'Vendor inventory ledger' : `Vendor: ${vendorName}`}
      summary={vendorId !== 'all' ? (
        <OperationalSummary
          items={[
            { id: 'received', label: 'units received', value: summary.unitsReceived },
            { id: 'sold', label: 'units sold', value: summary.unitsSold },
            { id: 'stock', label: 'currently in stock', value: summary.unitsInStock },
            { id: 'returned', label: 'returned', value: summary.unitsReturned },
            { id: 'serial', label: 'serialised rows', value: summary.serialisedUnits },
          ]}
        />
      ) : undefined}
      notice={
        <CompactInfoNotice>
          Ledger uses actual supplying vendor from validated purchase receipts.
          Quantity rows are receipt-line based; sale allocation is not fabricated without stock layers.
          {!showCost ? ' Purchase cost columns are hidden for your role.' : ''}
        </CompactInfoNotice>
      }
    >
      <DataTable
        tableId="inventory-vendor-ledger"
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search product, serial, PO, or receipt…"
        clientSearch={false}
        hideColumnFilters
        emptyMessage={vendorId === 'all' ? 'Select a vendor to load the ledger' : 'No ledger rows for this vendor / filters'}
        exportTitle="Vendor Inventory Ledger"
        exportFilename={baseName}
        exportFormats={['pdf', 'excel']}
        perPage={25}
        primaryFilters={[
          {
            key: 'vendor',
            label: 'Vendor',
            placeholder: 'Select vendor',
            value: vendorId,
            allValue: 'all',
            options: [
              { value: 'all', label: 'Select vendor…' },
              ...vendorOptions.map(v => ({ value: v.id, label: v.name })),
            ],
            onChange: setVendorId,
          } satisfies PrimaryFilterConfig,
          {
            key: 'warehouse',
            label: 'Warehouse',
            value: warehouse,
            allValue: 'all',
            options: [
              { value: 'all', label: 'All warehouses' },
              ...(['warehouse', 'shop', 'repair_unit'] as LocationId[]).map(id => ({
                value: id,
                label: LOCATIONS[id].name,
              })),
            ],
            onChange: v => setWarehouse(v as LocationId | 'all'),
          },
          {
            key: 'sold',
            label: 'Sold status',
            value: soldFilter,
            allValue: 'all',
            options: [
              { value: 'all', label: 'All statuses' },
              { value: 'not_sold', label: 'Not sold' },
              { value: 'sold', label: 'Sold' },
              { value: 'sold_and_returned', label: 'Sold and returned' },
              { value: 'returned_to_stock', label: 'Returned to stock' },
              { value: 'returned_to_vendor', label: 'Returned to vendor' },
              { value: 'scrapped', label: 'Scrapped' },
            ],
            onChange: v => setSoldFilter(v as VendorLedgerSoldFilter),
          },
        ]}
        overflowActions={[
          {
            id: 'csv',
            label: 'Export CSV',
            onSelect: () => {
              if (!rows.length) { showToast('Nothing to export', 'info'); return }
              downloadVendorLedgerCsv(rows, `${baseName}.csv`)
              addAuditLog('vendor_ledger_export', vendorId, `CSV ${rows.length} rows`)
            },
          },
          {
            id: 'pdf',
            label: 'Download PDF',
            onSelect: () => {
              if (!rows.length) { showToast('Nothing to export', 'info'); return }
              const { headers, data } = exportRows()
              exportToPDF('Vendor Inventory Ledger', headers, data, baseName)
              addAuditLog('vendor_ledger_export', vendorId, `PDF ${rows.length} rows`)
            },
          },
          {
            id: 'excel',
            label: 'Export Excel',
            onSelect: () => {
              if (!rows.length) { showToast('Nothing to export', 'info'); return }
              const { headers, data } = exportRows()
              exportToExcel('Vendor Inventory Ledger', headers, data, baseName)
              addAuditLog('vendor_ledger_export', vendorId, `Excel ${rows.length} rows`)
            },
          },
        ]}
      />
    </TablePageLayout>
  )
}
