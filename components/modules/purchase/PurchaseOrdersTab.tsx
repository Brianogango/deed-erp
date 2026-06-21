'use client'
import { useEffect, useMemo, useState } from 'react'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard, StatePanel } from '@/components/ui'

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
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

  useEffect(() => {
    setSelectedIds(prev => {
      const allowed = new Set(filteredPOs.map(po => po.id))
      const next = new Set(Array.from(prev).filter(id => allowed.has(id)))
      return next
    })
  }, [filteredPOs])

  const filterCounts = useMemo(() => ({
    all: purchaseOrders.length,
    rfq: purchaseOrders.filter(po => ['draft', 'sent'].includes(po.status)).length,
    po: purchaseOrders.filter(po => ['confirmed', 'partial'].includes(po.status)).length,
    received: purchaseOrders.filter(po => po.status === 'received').length,
  }), [purchaseOrders])

  const selectedOrders = useMemo(
    () => filteredPOs.filter(po => selectedIds.has(po.id)),
    [filteredPOs, selectedIds],
  )

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

  const toggleAll = () => {
    if (selectedIds.size === filteredPOs.length) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(filteredPOs.map(po => po.id)))
  }

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBulkApprove = () => {
    selectedOrders
      .filter(po => ['draft', 'sent'].includes(po.status))
      .forEach(po => confirmPO(po.id))
  }

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Purchase Orders / RFQs" count={filteredPOs.length}>
        <div className="flex gap-1 flex-wrap">
          {[{ v: 'all', label: 'All' }, { v: 'rfq', label: 'RFQs' }, { v: 'po', label: 'POs' }, { v: 'received', label: 'Received' }].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className="px-2.5 py-1 rounded-md text-[10px] cursor-pointer transition-all flex items-center gap-1.5"
              style={{ background: filter === f.v ? '#1B2762' : '#F3F4F6', color: filter === f.v ? '#fff' : '#6B7280', border: 'none' }}>
              <span>{f.label}</span>
              <span className="text-[9px] font-bold opacity-80">
                {filterCounts[f.v as keyof typeof filterCounts]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <button className="btn-outline text-[10px] py-1 px-2" onClick={() => {
                const target = selectedOrders[0]
                if (!target) return
                setActiveId(target.id)
                setSubView('form')
              }}>
                View ({selectedIds.size})
              </button>
              <button className="btn-outline text-[10px] py-1 px-2" onClick={runBulkApprove}>
                Approve
              </button>
              <button className="btn-outline text-[10px] py-1 px-2" onClick={() => exportOrders(selectedOrders)}>
                Export
              </button>
            </>
          )}
          <button className="btn-primary" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>
        </div>
      </PanelHeader>
      <div className="block lg:hidden p-3 space-y-3">
        {filteredPOs.length === 0 ? (
          <StatePanel
            tone="empty"
            title={purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No orders match this view'}
            description={purchaseOrders.length === 0 ? 'Create your first RFQ to begin purchasing from vendors.' : 'Try a different saved view or quick filter.'}
            action={<button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>}
          />
        ) : filteredPOs.map(po => {
          const isRFQ = po.status === 'draft' || po.status === 'sent'
          return (
            <RecordCard
              key={po.id}
              eyebrow={po.ref}
              title={po.vendorName}
              subtitle={isRFQ ? 'RFQ' : 'Purchase Order'}
              amount={fmtKes(po.total)}
              status={<Badge status={po.status === 'received' ? 'active' : po.status === 'cancelled' ? 'cancelled' : 'pending'} label={STATUS_LABEL[po.status]} size="xs" />}
              accent={isRFQ ? '#F59E0B' : '#3B82F6'}
              meta={[
                { label: 'Date', value: fmtDate(po.date) },
                { label: 'Lines', value: po.lines.length },
              ]}
              actions={
                <div className="flex gap-1.5">
                  <button className="btn-outline text-[10px] py-1 px-2" onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>View</button>
                  <button className="btn-outline text-[10px] py-1 px-2" onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>Edit</button>
                  <button className="btn-outline text-[10px] py-1 px-2" disabled={!['draft', 'sent'].includes(po.status)} onClick={e => { e.stopPropagation(); confirmPO(po.id) }}>Approve</button>
                  <button className="btn-outline text-[10px] py-1 px-2" onClick={e => { e.stopPropagation(); exportOrders([po]) }}>Export</button>
                </div>
              }
              onClick={() => {
                setActiveId(po.id)
                setSubView('form')
              }}
            />
          )
        })}
      </div>
      <div className="hidden lg:block">
        <div className="flex flex-col">
          <div className="table-head sticky top-0 z-[2]" style={{ gridTemplateColumns: '40px 90px 90px 1.5fr 100px 85px 90px 250px' }}>
            <span>
              <input type="checkbox" checked={filteredPOs.length > 0 && selectedIds.size === filteredPOs.length} onChange={toggleAll} aria-label="Select all rows" />
            </span>
            <span>Ref</span><span>Type</span><span>Vendor</span><span>Date</span><span>Total</span><span>Status</span><span>Actions</span>
          </div>
          {filteredPOs.length === 0 ? (
            <div className="p-4">
              <StatePanel
                tone="empty"
                title={purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No orders match this view'}
                description={purchaseOrders.length === 0 ? 'Create your first RFQ to begin purchasing from vendors.' : 'Try a different saved view or quick filter.'}
                action={<button className="btn-primary text-xs px-4 py-1.5 mt-1" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>}
              />
            </div>
          ) : filteredPOs.map(po => {
                const isRFQ = po.status === 'draft' || po.status === 'sent'
                return (
                  <div key={po.id}
                    className="table-row"
                    style={{ gridTemplateColumns: '40px 90px 90px 1.5fr 100px 85px 90px 250px' }}
                    onClick={() => { setActiveId(po.id); setSubView('form') }}>
                    <span>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(po.id)}
                        onChange={e => {
                          e.stopPropagation()
                          toggleOne(po.id)
                        }}
                        aria-label={`Select ${po.ref}`}
                      />
                    </span>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{po.ref}</span>
                    <span className="text-[10px]" style={{ color: isRFQ ? '#F59E0B' : '#3B82F6' }}>{isRFQ ? '📋 RFQ' : '🛒 PO'}</span>
                    <span className="font-medium text-t1">{po.vendorName}</span>
                    <span className="text-[11px] text-t3">{fmtDate(po.date)}</span>
                    <span className="font-mono text-[11px] font-semibold text-t1">{fmtKes(po.total)}</span>
                    <span className={`badge ${STATUS_BADGE[po.status]}`}>{STATUS_LABEL[po.status]}</span>
                    <div className="flex items-center gap-1.5">
                      <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>View</button>
                      <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>Edit</button>
                      <button className="btn-outline text-[10px] py-0.5 px-2" disabled={!['draft', 'sent'].includes(po.status)} onClick={e => { e.stopPropagation(); confirmPO(po.id) }}>Approve</button>
                      <button className="btn-outline text-[10px] py-0.5 px-2" onClick={e => { e.stopPropagation(); exportOrders([po]) }}>Export</button>
                    </div>
                  </div>
                )
              })
          }
        </div>
      </div>
    </div>
  )
}
