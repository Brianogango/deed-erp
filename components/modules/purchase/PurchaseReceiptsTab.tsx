'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader } from '@/components/ui'
import { LOCATIONS } from '@/lib/store'

export default function PurchaseReceiptsTab() {
  const { receipts, fmtDate } = usePurchase()

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Goods Receipts (GRN)" count={receipts.length} />
      <div className="overflow-x-auto w-full">
        <div className="min-w-[650px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 100px 70px' }}>
            <span>Ref</span><span>PO</span><span>Vendor</span><span>Date</span><span>Location</span><span>Status</span>
          </div>
          {receipts.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No GRNs yet</p>
            : [...receipts].reverse().map(r => (
                <div key={r.id} className="table-row" style={{ gridTemplateColumns: '90px 90px 1.6fr 100px 100px 70px' }}>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{r.ref}</span>
                  <span className="font-mono text-[10px] text-t3">{r.poRef}</span>
                  <span className="text-t1">{r.vendorName}</span>
                  <span className="text-[11px] text-t3">{fmtDate(r.date)}</span>
                  <span className="text-[11px] text-t2">{LOCATIONS[r.destinationLocation].icon} {LOCATIONS[r.destinationLocation].name}</span>
                  <Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? '✓ Done' : 'Pending'} />
                </div>
              ))
          }
        </div>
      </div>
    </div>
  )
}
