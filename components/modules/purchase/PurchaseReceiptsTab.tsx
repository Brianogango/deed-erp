'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard } from '@/components/ui'
import { LOCATIONS } from '@/lib/store'

export default function PurchaseReceiptsTab() {
  const { receipts, fmtDate } = usePurchase()

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Goods Receipts (GRN)" count={receipts.length} />
      <div className="block lg:hidden p-3 space-y-3">
        {receipts.length === 0 ? (
          <p className="py-10 text-center text-xs text-t3">No GRNs yet</p>
        ) : [...receipts].reverse().map(r => (
          <RecordCard
            key={r.id}
            eyebrow={r.ref}
            title={r.vendorName}
            subtitle={`PO ${r.poRef}`}
            status={<Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? 'Done' : 'Pending'} size="xs" />}
            accent={r.status === 'validated' ? '#10B981' : '#F59E0B'}
            meta={[
              { label: 'Date', value: fmtDate(r.date) },
              { label: 'Location', value: `${LOCATIONS[r.destinationLocation].icon} ${LOCATIONS[r.destinationLocation].name}` },
            ]}
          />
        ))}
      </div>
      <div className="hidden lg:block">
        <div className="flex flex-col">
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
