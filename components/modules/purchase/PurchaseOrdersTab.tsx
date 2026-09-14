'use client'
import { useEffect, useMemo, useRef } from 'react'
import { useUrlUiPatch, useUrlUiState } from '@/hooks/useUrlRecordId'
import { usePurchase } from './PurchaseContext'
import { PanelHeader, RecordCard } from '@/components/ui'
import { StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import type { PurchaseOrder } from '@/lib/store'
import {
  countPurchaseFilterFacets,
  PURCHASE_LIFECYCLE_STATUSES,
  PURCHASE_STATUS_FILTER_LABELS,
  parsePurchaseSavedView,
  purchaseDocType,
  purchaseSavedViewQueryPatch,
  type PurchaseStatusFilter,
  type PurchaseTypeFilter,
} from '@/lib/purchases-filter'

const STATUS_LABEL: Record<string, string> = {
  draft: 'RFQ', sent: 'RFQ Sent', confirmed: 'Purchase Order',
  partial: 'Partially Received', received: 'Fully Received', cancelled: 'Cancelled',
}

// Matches lib/store.tsx's canManageProcurement — the actual gate behind
// createPO/confirmPO. Buttons that trigger those actions must be hidden for
// any other role, or clicking them is a guaranteed-denied dead end.
const CAN_MANAGE_PROCUREMENT_ROLES = ['director', 'admin_officer', 'inventory_officer']
const APPROVABLE_PURCHASE_STATUSES = ['draft', 'sent']

export default function PurchaseOrdersTab() {
  const {
    purchaseOrders, filteredPOs, typeFilter, setTypeFilter, statusFilter, setStatusFilter,
    setActiveId, setSubView, setShowNewRFQ, fmtKes, fmtDate, confirmPO, currentUser,
  } = usePurchase()
  const canManageProcurement = CAN_MANAGE_PROCUREMENT_ROLES.includes(currentUser?.role ?? '')
  const savedViewKey = 'deed_po_saved_view'
  const patchUi = useUrlUiPatch()
  const savedViewHydrated = useRef(false)
  const [search, setSearchValue] = useUrlUiState('q', '')
  const [pageValue, setPageValue] = useUrlUiState('page', '1')
  const currentPage = Math.max(1, Number.parseInt(pageValue, 10) || 1)
  const setSearch = (value: string) => setSearchValue(value, { queryPatch: { page: null } })
  const setPage = (page: number) => setPageValue(String(Math.max(1, page)))

  useEffect(() => {
    // Saved-view hydration is a one-time mount concern. patchUi changes identity
    // when the URL changes; without this gate, clicking page 2 reruns hydration
    // and can erase the pagination query.
    if (savedViewHydrated.current) return
    savedViewHydrated.current = true

    // A URL/deep-link selection wins over the user's local saved view.
    if (typeFilter !== 'all' || statusFilter !== 'all') return
    try {
      const stored = localStorage.getItem(savedViewKey)
      if (!stored) return
      const savedView = parsePurchaseSavedView(stored)
      if (savedView) patchUi(purchaseSavedViewQueryPatch(savedView))
    } catch {
      // ignore storage failures
    }
  }, [patchUi, typeFilter, statusFilter])

  useEffect(() => {
    try {
      localStorage.setItem(savedViewKey, JSON.stringify({ type: typeFilter, status: statusFilter }))
    } catch {
      // ignore storage failures
    }
  }, [typeFilter, statusFilter])

  const filterCounts = useMemo(
    () => countPurchaseFilterFacets(purchaseOrders, typeFilter as PurchaseTypeFilter, statusFilter as PurchaseStatusFilter),
    [purchaseOrders, typeFilter, statusFilter],
  )

  const primaryFilters: PrimaryFilterConfig[] = [
    {
      key: 'type',
      label: 'Type',
      placeholder: 'All types',
      value: typeFilter,
      allValue: 'all',
      options: [
        { value: 'all', label: `All (${filterCounts.type.all})` },
        { value: 'rfq', label: `RFQ (${filterCounts.type.rfq})` },
        { value: 'po', label: `PO (${filterCounts.type.po})` },
      ],
      onChange: setTypeFilter,
    },
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      value: statusFilter,
      allValue: 'all',
      options: [
        { value: 'all', label: `All (${filterCounts.status.all})` },
        ...PURCHASE_LIFECYCLE_STATUSES.map(status => ({
          value: status,
          label: `${PURCHASE_STATUS_FILTER_LABELS[status]} (${filterCounts.status[status]})`,
        })),
      ],
      onChange: setStatusFilter,
    },
  ]

  const exportOrders = (rows: typeof filteredPOs) => {
    if (rows.length === 0) return
    const csv = [
      ['Ref', 'Type', 'Vendor', 'Date', 'Total', 'Status'].join(','),
      ...rows.map(po => ([
        po.ref,
        purchaseDocType(po.status) === 'rfq' ? 'RFQ' : 'PO',
        po.vendorName,
        fmtDate(po.date),
        String(po.total),
        STATUS_LABEL[po.status],
      ]).map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const openOrder = (po: PurchaseOrder) => {
    setActiveId(po.id)
    setSubView('form')
  }

  const canApproveOrder = (po: PurchaseOrder) => canManageProcurement && APPROVABLE_PURCHASE_STATUSES.includes(po.status)

  const columns: ColumnDef<PurchaseOrder>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: po => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{po.ref}</span>,
    },
    {
      key: 'type', label: 'Type', priority: 1, width: '90px',
      render: po => {
        const isRFQ = purchaseDocType(po.status) === 'rfq'
        return <span className="text-[10px] font-semibold" style={{ color: isRFQ ? 'var(--warning)' : 'var(--primary)' }}>{isRFQ ? 'RFQ' : 'PO'}</span>
      },
      exportValue: po => purchaseDocType(po.status) === 'rfq' ? 'RFQ' : 'PO',
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.5fr',
      render: po => <span className="font-medium text-t1 erp-truncate" title={po.vendorName}>{po.vendorName}</span>,
      exportValue: po => po.vendorName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '120px',
      render: po => <StatusBadge status={po.status} label={STATUS_LABEL[po.status]} />,
      exportValue: po => STATUS_LABEL[po.status],
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: po => <span className="text-[11px] text-t3">{fmtDate(po.date)}</span>,
      exportValue: po => po.date,
    },
    {
      key: 'total', label: 'Total', priority: 2, width: '85px', align: 'right',
      render: po => <span className="font-mono text-[11px] font-semibold text-t1">{fmtKes(po.total)}</span>,
      exportValue: po => po.total,
      footer: pageRows => (
        <span className="font-mono text-[11px] font-bold tabular-nums">
          {fmtKes(pageRows.reduce((sum, po) => sum + po.total, 0))}
        </span>
      ),
    },
  ]

  function poRowActions(po: PurchaseOrder) {
    return (
      <>
        <button
          type="button"
          className="btn-outline min-h-9 text-[10px] px-2"
          aria-label={`Open ${po.ref}`}
          onClick={e => { e.stopPropagation(); openOrder(po) }}
        >
          Open
        </button>
        {canApproveOrder(po) && (
          <button
            type="button"
            className="btn-primary min-h-9 text-[10px] px-2"
            aria-label={`Approve ${po.ref}`}
            onClick={e => { e.stopPropagation(); confirmPO(po.id) }}
          >
            Approve
          </button>
        )}
        <button
          type="button"
          className="btn-outline min-h-9 text-[10px] px-2"
          aria-label={`Export ${po.ref}`}
          onClick={e => { e.stopPropagation(); exportOrders([po]) }}
        >
          Export
        </button>
      </>
    )
  }

  return (
    <section className="card overflow-hidden purchase-directory purchase-orders-panel" aria-label="Purchase orders and requests for quotation">
      <PanelHeader title="Purchase Orders / RFQs" count={filteredPOs.length} />
      <DataTable
        tableId="purchase_orders"
        columns={columns}
        rows={filteredPOs}
        rowKey={po => po.id}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search purchase orders by ref or vendor..."
        page={currentPage}
        onPageChange={setPage}
        primaryFilters={primaryFilters}
        onClearFilters={() => patchUi({ type: null, status: null, page: null })}
        hideColumnFilters
        selectable
        emptyMessage={purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No orders match this view'}
        emptyAction={canManageProcurement ? (
          <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>
        ) : undefined}
        onRowClick={openOrder}
        rowActions={poRowActions}
        bulkActions={({ rows }) => {
          const approvableRows = rows.filter(canApproveOrder)
          return (
            <>
              <button className="btn-outline text-[10px] py-1 px-2" onClick={() => {
                const target = rows[0]
                if (!target) return
                openOrder(target)
              }}>
                Open first ({rows.length})
              </button>
              {approvableRows.length > 0 && (
                <button className="btn-primary text-[10px] py-1 px-2" onClick={() => approvableRows.forEach(po => confirmPO(po.id))}>
                  Approve ({approvableRows.length})
                </button>
              )}
              <button className="btn-outline text-[10px] py-1 px-2" onClick={() => exportOrders(rows)}>
                Export
              </button>
            </>
          )
        }}
        renderCard={po => {
          const isRFQ = purchaseDocType(po.status) === 'rfq'
          return (
            <RecordCard
              key={po.id}
              eyebrow={po.ref}
              title={po.vendorName}
              subtitle={isRFQ ? 'RFQ' : 'Purchase Order'}
              amount={fmtKes(po.total)}
              status={<StatusBadge status={po.status} label={STATUS_LABEL[po.status]} size="xs" />}
              accent={isRFQ ? 'var(--warning)' : 'var(--primary)'}
              meta={[
                { label: 'Date', value: fmtDate(po.date) },
                { label: 'Lines', value: po.lines.length },
              ]}
              actions={poRowActions(po)}
              onClick={() => openOrder(po)}
            />
          )
        }}
        exportTitle="Purchase Orders"
        exportFilename="purchase-orders"
      />
    </section>
  )
}
