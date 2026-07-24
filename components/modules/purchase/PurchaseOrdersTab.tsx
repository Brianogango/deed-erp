'use client'
import { useEffect, useMemo, useState } from 'react'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import type { PurchaseOrder } from '@/lib/store'

const STATUS_LABEL: Record<string, string> = {
  draft: 'RFQ', sent: 'RFQ Sent', confirmed: 'Purchase Order',
  partial: 'Partially Received', received: 'Fully Received', cancelled: 'Cancelled',
}
const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-gray', sent: 'badge-amber', confirmed: 'badge-blue',
  partial: 'badge-amber', received: 'badge-green', cancelled: 'badge-red',
}

export default function PurchaseOrdersTab() {
  const {
    purchaseOrders, filteredPOs, filter, setFilter, setActiveId, setSubView,
    setShowNewRFQ, fmtKes, fmtDate, confirmPO,
  } = usePurchase()
  const savedViewKey = 'deed_po_saved_view'

  useEffect(() => {
    try {
      const stored = localStorage.getItem(savedViewKey)
      if (stored && ['all', 'rfq', 'po', 'received'].includes(stored)) {
        setFilter(stored)
      }
    } catch {
      // ignore storage failures
    }
  }, [setFilter])

  useEffect(() => {
    try {
      localStorage.setItem(savedViewKey, filter)
    } catch {
      // ignore storage failures
    }
  }, [filter])

  const filterCounts = useMemo(() => ({
    all: purchaseOrders.length,
    rfq: purchaseOrders.filter(po => ['draft', 'sent'].includes(po.status)).length,
    po: purchaseOrders.filter(po => ['confirmed', 'partial'].includes(po.status)).length,
    received: purchaseOrders.filter(po => po.status === 'received').length,
  }), [purchaseOrders])

  const exportOrders = (rows: typeof filteredPOs) => {
    if (rows.length === 0) return
    const csv = [
      ['Ref', 'Type', 'Vendor', 'Date', 'Total', 'Status'].join(','),
      ...rows.map(po => ([
        po.ref,
        ['draft', 'sent'].includes(po.status) ? 'RFQ' : 'PO',
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
        const isRFQ = po.status === 'draft' || po.status === 'sent'
        return <span className="text-[10px]" style={{ color: isRFQ ? 'var(--warning)' : 'var(--primary)' }}>{isRFQ ? '📋 RFQ' : '🛒 PO'}</span>
      },
      exportValue: po => ['draft', 'sent'].includes(po.status) ? 'RFQ' : 'PO',
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.5fr',
      render: po => <span className="font-medium text-t1">{po.vendorName}</span>,
      exportValue: po => po.vendorName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '120px',
      render: po => <span className={`badge ${STATUS_BADGE[po.status]}`}>{STATUS_LABEL[po.status]}</span>,
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
        <button className="btn-outline text-[10px] py-0.5 px-2" disabled={!['draft', 'sent'].includes(po.status)} onClick={e => { e.stopPropagation(); confirmPO(po.id) }}>Approve</button>
        <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); exportOrders([po]) }}>Export</button>
      </>
    )
  }

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Purchase Orders / RFQs" count={filteredPOs.length}>
        <div className="flex gap-1 flex-wrap">
          {[{ v: 'all', label: 'All' }, { v: 'rfq', label: 'RFQs' }, { v: 'po', label: 'POs' }, { v: 'received', label: 'Received' }].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className="px-2.5 py-1 rounded-md text-[10px] cursor-pointer transition-all flex items-center gap-1.5"
              style={{ background: filter === f.v ? 'var(--navy)' : 'var(--bg-muted)', color: filter === f.v ? '#fff' : 'var(--text-4)', border: 'none' }}>
              <span>{f.label}</span>
              <span className="text-[9px] font-bold opacity-80">
                {filterCounts[f.v as keyof typeof filterCounts]}
              </span>
            </button>
          ))}
        </div>
      </PanelHeader>
      <DataTable
        tableId="purchase_orders"
        columns={columns}
        rows={filteredPOs}
        rowKey={po => po.id}
        hideSearch
        selectable
        emptyMessage={purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No orders match this view'}
        emptyAction={<button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>}
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
            <button className="btn-outline text-[10px] py-1 px-2" onClick={() => rows.filter(po => ['draft', 'sent'].includes(po.status)).forEach(po => confirmPO(po.id))}>
              Approve
            </button>
            <button className="btn-outline text-[10px] py-1 px-2" onClick={() => exportOrders(rows)}>
              Export
            </button>
          </>
        )}
        renderCard={po => {
          const isRFQ = po.status === 'draft' || po.status === 'sent'
          return (
            <RecordCard
              key={po.id}
              eyebrow={po.ref}
              title={po.vendorName}
              subtitle={isRFQ ? 'RFQ' : 'Purchase Order'}
              amount={fmtKes(po.total)}
              status={<Badge status={po.status === 'received' ? 'active' : po.status === 'cancelled' ? 'cancelled' : 'pending'} label={STATUS_LABEL[po.status]} size="xs" />}
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
