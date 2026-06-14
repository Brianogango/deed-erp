'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard } from '@/components/ui'

export default function PurchaseBillsTab() {
  const {
    vendorBills, purchaseOrders, postInvoice, currentUser,
    fmtKes, fmtDate,
  } = usePurchase()
  const canValidateBills = ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Vendor Bills" count={vendorBills.length} />
      <div className="block md:hidden p-3 space-y-3">
        {vendorBills.length === 0 ? (
          <p className="py-10 text-center text-xs text-t3">No vendor bills yet</p>
        ) : vendorBills.map(b => {
          const outstanding = b.total - b.amountPaid
          const linkedPORef = b.purchaseOrderId ? (purchaseOrders.find(p => p.id === b.purchaseOrderId)?.ref ?? '—') : '—'
          return (
            <RecordCard
              key={b.id}
              eyebrow={b.ref}
              title={b.partnerName}
              subtitle={`PO ${linkedPORef}`}
              amount={fmtKes(outstanding)}
              status={<Badge status={b.status} size="xs" />}
              accent={outstanding > 0 ? '#EF4444' : '#10B981'}
              meta={[
                { label: 'Due', value: fmtDate(b.dueDate) },
                { label: 'Total', value: fmtKes(b.total) },
                { label: 'Paid', value: fmtKes(b.amountPaid) },
                { label: 'Outstanding', value: fmtKes(outstanding) },
              ]}
              actions={b.status === 'draft' && canValidateBills ? (
                <button className="btn-primary text-[10px] py-1.5 px-3" style={{ background: '#10B981' }} onClick={() => postInvoice(b.id)}>Validate</button>
              ) : undefined}
            />
          )
        })}
      </div>
      <div className="hidden md:block overflow-x-auto w-full">
        <div className="min-w-[800px] flex flex-col">
          <div className="table-head" style={{ gridTemplateColumns: '90px 90px 1.4fr 100px 85px 85px 85px 90px' }}>
            <span>Ref</span><span>PO</span><span>Vendor</span><span>Due Date</span>
            <span>Total</span><span>Paid</span><span>Outstanding</span><span>Actions</span>
          </div>
          {vendorBills.length === 0
            ? <p className="py-10 text-center text-xs text-t3">No vendor bills yet</p>
            : vendorBills.map(b => {
                const outstanding   = b.total - b.amountPaid
                const isPaid        = outstanding <= 0
                const linkedPORef   = b.purchaseOrderId
                  ? (purchaseOrders.find(p => p.id === b.purchaseOrderId)?.ref ?? '—')
                  : '—'
                return (
                  <div key={b.id} className="table-row" style={{ gridTemplateColumns: '90px 90px 1.4fr 100px 85px 85px 85px 90px' }}>
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#1B2762' }}>{b.ref}</span>
                    <span className="font-mono text-[10px] text-t3">{linkedPORef}</span>
                    <span className="text-t1">{b.partnerName}</span>
                    <span className="text-[11px] text-t3">{fmtDate(b.dueDate)}</span>
                    <span className="font-mono text-[11px] text-t1">{fmtKes(b.total)}</span>
                    <span className="font-mono text-[11px]" style={{ color: '#10B981' }}>{fmtKes(b.amountPaid)}</span>
                    <span className="font-mono text-[11px]" style={{ color: isPaid ? '#10B981' : '#EF4444' }}>{fmtKes(outstanding)}</span>
                    <div className="flex items-center gap-1.5">
                      {b.status === 'draft' && canValidateBills && (
                        <button className="btn-primary text-[9px] py-0.5 px-2" style={{ background: '#10B981' }}
                          onClick={e => { e.stopPropagation(); postInvoice(b.id) }}>Validate</button>
                      )}
                      {(b.status === 'posted' || b.status === 'partially_paid' || b.status === 'overdue') && outstanding > 0 && (
                        <span className="text-[9px] text-[var(--text-4)] italic">Pay via Finance</span>
                      )}
                      <Badge status={b.status} size="xs" />
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
