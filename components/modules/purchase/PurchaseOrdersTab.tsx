'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader } from '@/components/ui'
import { LOCATIONS } from '@/lib/store'

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
    filteredPOs, filter, setFilter, setActiveId, setSubView,
    setShowNewRFQ, fmtKes, fmtDate,
  } = usePurchase()

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Purchase Orders / RFQs" count={filteredPOs.length}>
        <div className="flex gap-1">
          {[{ v: 'all', label: 'All' }, { v: 'rfq', label: 'RFQs' }, { v: 'po', label: 'POs' }, { v: 'received', label: 'Received' }].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className="px-2.5 py-1 rounded-md text-[10px] cursor-pointer transition-all"
              style={{ background: filter === f.v ? '#1B2762' : '#F3F4F6', color: filter === f.v ? '#fff' : '#6B7280', border: 'none' }}>
              {f.label}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setShowNewRFQ(true)}>+ New RFQ</button>
      </PanelHeader>
      <div className="overflow-x-auto w-full">
        <div className="min-w-[700px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 85px 80px 60px' }}>
            <span>Ref</span><span>Type</span><span>Vendor</span><span>Date</span><span>Total</span><span>Status</span><span></span>
          </div>
          {filteredPOs.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No orders found</p>
            : filteredPOs.map(po => {
                const isRFQ = po.status === 'draft' || po.status === 'sent'
                return (
                  <div key={po.id}
                    className="table-row"
                    style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 85px 80px 60px' }}
                    onClick={() => { setActiveId(po.id); setSubView('form') }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{po.ref}</span>
                    <span className="text-[10px]" style={{ color: isRFQ ? '#F59E0B' : '#3B82F6' }}>{isRFQ ? '📋 RFQ' : '🛒 PO'}</span>
                    <span className="font-medium text-t1">{po.vendorName}</span>
                    <span className="text-[11px] text-t3">{fmtDate(po.date)}</span>
                    <span className="font-mono text-[11px] font-semibold text-t1">{fmtKes(po.total)}</span>
                    <span className={`badge ${STATUS_BADGE[po.status]}`}>{STATUS_LABEL[po.status]}</span>
                    <button className="btn-outline text-[10px] py-0.5 px-2"
                      onClick={e => { e.stopPropagation(); setActiveId(po.id); setSubView('form') }}>Open</button>
                  </div>
                )
              })
          }
        </div>
      </div>
    </div>
  )
}
