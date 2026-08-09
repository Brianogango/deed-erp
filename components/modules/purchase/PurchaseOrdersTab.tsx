'use client'
import { useEffect, useMemo } from 'react'
import { usePurchase } from './PurchaseContext'
import { PanelHeader, RecordCard } from '@/components/ui'
import { StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import type { PurchaseOrder } from '@/lib/store'
import {
  countPurchaseFilterFacets,
  PURCHASE_LIFECYCLE_STATUSES,
  PURCHASE_STATUS_FILTER_LABELS,
  purchaseDocType,
  type PurchaseStatusFilter,
  type PurchaseTypeFilter,
} from '@/lib/purchases-filter'

const STATUS_LABEL: Record<string, string> = {
  draft: 'RFQ', sent: 'RFQ Sent', confirmed: 'Purchase Order',
  partial: 'Partially Received', received: 'Fully Received', cancelled: 'Cancelled',
}

const TYPE_FILTERS: PurchaseTypeFilter[] = ['all', 'rfq', 'po']
const STATUS_FILTERS: PurchaseStatusFilter[] = ['all', ...PURCHASE_LIFECYCLE_STATUSES]

function isTypeFilter(value: string): value is PurchaseTypeFilter {
  return (TYPE_FILTERS as string[]).includes(value)
}

function isStatusFilter(value: string): value is PurchaseStatusFilter {
  return (STATUS_FILTERS as string[]).includes(value)
}

/** Migrate legacy single-filter saved views (`rfq` | `po` | `received` | status). */
function migrateLegacySavedView(stored: string): {
  typeFilter: PurchaseTypeFilter
  statusFilter: PurchaseStatusFilter
} | null {
  if (stored === 'all') return { typeFilter: 'all', statusFilter: 'all' }
  if (stored === 'rfq') return { typeFilter: 'rfq', statusFilter: 'all' }
  if (stored === 'po') return { typeFilter: 'po', statusFilter: 'all' }
  if (isStatusFilter(stored) && stored !== 'all') {
    return { typeFilter: 'all', statusFilter: stored }
  }
  return null
}

// Matches lib/store.tsx's canManageProcurement — the actual gate behind
// createPO/confirmPO. Buttons that trigger those actions must be hidden for
// any other role, or clicking them is a guaranteed-denied dead end.
const CAN_MANAGE_PROCUREMENT_ROLES = ['director', 'admin_officer', 'inventory_officer']

export default function PurchaseOrdersTab() {
  const {
    purchaseOrders, filteredPOs, typeFilter, setTypeFilter, statusFilter, setStatusFilter,
    setActiveId, setSubView, setShowNewRFQ, fmtKes, fmtDate, confirmPO, currentUser,
  } = usePurchase()
  const canManageProcurement = CAN_MANAGE_PROCUREMENT_ROLES.includes(currentUser?.role ?? '')
  const savedViewKey = 'deed_po_saved_view'

  useEffect(() => {
    try {
      const stored = localStorage.getItem(savedViewKey)
      if (!stored) return

      try {
        const parsed = JSON.parse(stored) as { type?: string; status?: string }
        if (parsed && typeof parsed === 'object' && (parsed.type || parsed.status)) {
          if (parsed.type && isTypeFilter(parsed.type)) setTypeFilter(parsed.type)
          if (parsed.status && isStatusFilter(parsed.status)) setStatusFilter(parsed.status)
          return
        }
      } catch {
        // not JSON — try legacy string values
      }

      const migrated = migrateLegacySavedView(stored)
      if (migrated) {
        setTypeFilter(migrated.typeFilter)
        setStatusFilter(migrated.statusFilter)
      }
    } catch {
      // ignore storage failures
    }
  }, [setTypeFilter, setStatusFilter])

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
    },
  ]

  function poRowActions(po: PurchaseOrder) {
    return (
      <>
        <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>View</button>
        <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>Edit</button>
        {canManageProcurement && (
          <button className="btn-outline text-[10px] py-0.5 px-2" disabled={!['draft', 'sent'].includes(po.status)} onClick={e => { e.stopPropagation(); confirmPO(po.id) }}>Approve</button>
        )}
        <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); exportOrders([po]) }}>Export</button>
      </>
    )
  }

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Purchase Orders / RFQs" count={filteredPOs.length} />
      <DataTable
        tableId="purchase_orders"
        columns={columns}
        rows={filteredPOs}
        rowKey={po => po.id}
        searchPlaceholder="Search purchase orders by ref or vendor..."
        primaryFilters={primaryFilters}
        onClearFilters={() => { setTypeFilter('all'); setStatusFilter('all') }}
        hideColumnFilters
        selectable
        emptyMessage={purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No orders match this view'}
        emptyAction={canManageProcurement ? (
          <button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>
        ) : undefined}
        onRowClick={po => { setActiveId(po.id); setSubView('form') }}
        rowActions={poRowActions}
        bulkActions={({ rows }) => (
          <>
            <button className="btn-outline text-[10px] py-1 px-2" onClick={() => {
              const target = rows[0]
              if (!target) return
              setActiveId(target.id)
              setSubView('form')
            }}>
              View ({rows.length})
            </button>
            {canManageProcurement && (
              <button className="btn-outline text-[10px] py-1 px-2" onClick={() => rows.filter(po => ['draft', 'sent'].includes(po.status)).forEach(po => confirmPO(po.id))}>
                Approve
              </button>
            )}
            <button className="btn-outline text-[10px] py-1 px-2" onClick={() => exportOrders(rows)}>
              Export
            </button>
          </>
        )}
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
              actions={<div className="flex gap-1.5">{poRowActions(po)}</div>}
              onClick={() => { setActiveId(po.id); setSubView('form') }}
            />
          )
        }}
        exportTitle="Purchase Orders"
        exportFilename="purchase-orders"
      />
    </div>
  )
}
