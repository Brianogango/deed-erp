'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, Select, RecordCard } from '@/components/ui'
import { DataTable, DetailsDrawer, type ColumnDef, type DrawerTab } from '@/components/data-table'
import type { PurchaseReturn } from '@/lib/store'

const REASON_OPTS = [
  { value: 'damaged',      label: '🔴 Damaged goods' },
  { value: 'wrong_supply', label: '❌ Wrong supply' },
  { value: 'excess',       label: '📦 Excess stock' },
  { value: 'other',        label: '📝 Other' },
]

export default function PurchaseReturnsTab() {
  const {
    purchaseReturns, serials,
    retSearchSerial, setRetSearchSerial,
    retFilterStatus, setRetFilterStatus,
    retFilterReason, setRetFilterReason,
    retFilterVendor, setRetFilterVendor,
    retDateFrom, setRetDateFrom,
    retDateTo, setRetDateTo,
    retExpandedId, setRetExpandedId,
    setShowPickupModal, setPickupReturnId,
    setPickupCollectedBy, setPickupCollectedDate, setPickupNotes,
    fmtDate,
  } = usePurchase()

  const uniqueVendors = Array.from(new Map(purchaseReturns.map(r => [r.vendorId, r.vendorName] as [string, string])))

  const filtered = purchaseReturns.filter(r => {
    if (retFilterStatus !== 'all' && r.status !== retFilterStatus) return false
    if (retFilterReason !== 'all' && r.reason !== retFilterReason) return false
    if (retFilterVendor !== 'all' && r.vendorId !== retFilterVendor) return false
    if (retDateFrom && r.date < retDateFrom) return false
    if (retDateTo   && r.date > retDateTo)   return false
    if (retSearchSerial.trim()) {
      const q = retSearchSerial.trim().toUpperCase()
      const hasSerial = r.lines.some(l => l.serialIds.some(sid => {
        const sn = serials.find(s => s.id === sid)
        return sn?.serial.includes(q)
      }))
      if (!hasSerial) return false
    }
    return true
  })

  const hasFilters = retSearchSerial || retFilterStatus !== 'all' || retFilterReason !== 'all' || retFilterVendor !== 'all' || retDateFrom || retDateTo

  const returnColumns: ColumnDef<PurchaseReturn>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '85px',
      render: r => <span className="font-mono text-[11px] font-semibold" style={{ color: '#F59E0B' }}>{r.ref}</span>,
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.2fr',
      render: r => <span className="text-t1 text-xs">{r.vendorName}</span>,
      exportValue: r => r.vendorName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '100px',
      render: r => <Badge status={r.status === 'confirmed' ? 'active' : 'pending'} label={r.status} />,
      exportValue: r => r.status,
    },
    {
      key: 'po', label: 'PO', priority: 2, width: '85px',
      render: r => <span className="font-mono text-[10px] text-t3">{r.poRef}</span>,
      exportValue: r => r.poRef,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '90px',
      render: r => <span className="text-[11px] text-t3">{fmtDate(r.date)}</span>,
      exportValue: r => r.date,
    },
    {
      key: 'reason', label: 'Reason', priority: 2, width: '110px',
      render: r => <span className="text-[11px] text-t2">{REASON_OPTS.find(x => x.value === r.reason)?.label ?? r.reason}</span>,
      exportValue: r => r.reason,
    },
    {
      key: 'collectedBy', label: 'Collected By', priority: 3, width: '120px',
      render: r => <span className="text-[11px]" style={{ color: r.collectedByName ? '#374151' : '#9CA3AF' }}>{r.collectedByName ?? <span className="italic">Not logged</span>}</span>,
      exportValue: r => r.collectedByName ?? '',
    },
    {
      key: 'collectionDate', label: 'Collection Date', priority: 3, width: '110px',
      render: r => <span className="text-[11px] text-t3">{r.collectedDate ? fmtDate(r.collectedDate) : '—'}</span>,
      exportValue: r => r.collectedDate ?? '',
    },
  ]

  function returnRowActions(r: PurchaseReturn) {
    return !r.collectedByName ? (
      <button className="btn-primary text-[10px] py-1.5 px-3"
        onClick={e => { e.stopPropagation(); setPickupReturnId(r.id); setPickupCollectedBy(''); setPickupCollectedDate(new Date().toISOString().slice(0,10)); setPickupNotes(''); setShowPickupModal(true) }}>
        Log Pickup
      </button>
    ) : null
  }

  function returnDrawerTabs(r: PurchaseReturn): DrawerTab[] {
    return [
      {
        id: 'overview',
        label: 'Items Returned',
        content: (
          <div className="flex flex-col gap-1.5">
            {r.lines.map((l, li) => {
              const lineSerials = l.serialIds.map(sid => serials.find(s => s.id === sid)).filter(Boolean)
              return (
                <div key={li} className="rounded-lg p-2.5" style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-t1">{l.productName}</p>
                    <span className="text-[10px] font-mono text-t2">Qty: {l.qty}</span>
                  </div>
                  {lineSerials.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {lineSerials.map(sn => sn && (
                        <div key={sn.id} className="flex flex-col gap-0.5 px-2 py-1 rounded"
                          style={{ background: '#FEF9C3', border: '1px solid #FDE68A' }}>
                          <span className="font-mono text-[10px] font-semibold" style={{ color: '#92400E' }}>{sn.serial}</span>
                          {(sn.accessories?.length ?? 0) > 0 && <span className="text-[9px]" style={{ color: '#78716C' }}>📦 {sn.accessories?.join(', ')}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ),
      },
      {
        id: 'notes',
        label: 'Pickup / Dispatch',
        content: (
          <div className="rounded-lg p-3" style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
            {r.collectedByName ? (
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between"><span className="text-t3">Collected by</span><span className="font-medium text-t1">{r.collectedByName}</span></div>
                <div className="flex justify-between"><span className="text-t3">Collection date</span><span className="text-t2">{r.collectedDate ? fmtDate(r.collectedDate) : '—'}</span></div>
                {r.pickupNotes && <div className="mt-1 p-2 rounded text-[10px] text-t2" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>{r.pickupNotes}</div>}
                <button className="btn-outline text-[10px] py-1 mt-1"
                  onClick={() => { setPickupReturnId(r.id); setPickupCollectedBy(r.collectedByUserId ?? ''); setPickupCollectedDate(r.collectedDate ?? new Date().toISOString().slice(0,10)); setPickupNotes(r.pickupNotes ?? ''); setShowPickupModal(true) }}>
                  ✏ Edit Pickup Details
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center py-3 gap-2">
                <p className="text-[11px] text-t3 text-center">Pickup not yet logged</p>
                <button className="btn-primary text-[11px] py-1.5"
                  onClick={() => { setPickupReturnId(r.id); setPickupCollectedBy(''); setPickupCollectedDate(new Date().toISOString().slice(0,10)); setPickupNotes(''); setShowPickupModal(true) }}>
                  + Log Pickup
                </button>
              </div>
            )}
          </div>
        ),
      },
    ]
  }

  const drawerReturn = retExpandedId ? filtered.find(r => r.id === retExpandedId) ?? null : null

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Search by serial</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs">🔍</span>
            <input className="form-input pl-8 text-xs font-mono" placeholder="e.g. SN001…"
              value={retSearchSerial} onChange={e => setRetSearchSerial(e.target.value)} />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Status</p>
          <div className="flex gap-1">
            {[['all','All'],['draft','Draft'],['confirmed','Confirmed']].map(([v,l]) => (
              <button key={v} onClick={() => setRetFilterStatus(v)}
                className="px-2.5 py-1 rounded-md text-[10px] transition-all"
                style={{ background: retFilterStatus === v ? '#1B2762' : '#F3F4F6', color: retFilterStatus === v ? '#fff' : '#6B7280', border: 'none', cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Reason</p>
          <Select value={retFilterReason} onChange={setRetFilterReason}
            options={[{ value: 'all', label: 'All reasons' }, ...REASON_OPTS.map(r => ({ value: r.value, label: r.label }))]} />
        </div>
        {uniqueVendors.length > 1 && (
          <div>
            <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">Vendor</p>
            <Select value={retFilterVendor} onChange={setRetFilterVendor}
              options={[{ value: 'all', label: 'All vendors' }, ...uniqueVendors.map(([id, name]) => ({ value: id, label: name }))]} />
          </div>
        )}
        <div className="flex gap-2">
          <div>
            <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">From</p>
            <input className="form-input text-xs py-1.5" type="date" value={retDateFrom} onChange={e => setRetDateFrom(e.target.value)} />
          </div>
          <div>
            <p className="text-[10px] text-t3 mb-1 uppercase tracking-wider">To</p>
            <input className="form-input text-xs py-1.5" type="date" value={retDateTo} onChange={e => setRetDateTo(e.target.value)} />
          </div>
        </div>
        {hasFilters && (
          <button className="btn-outline text-[10px] py-1.5 self-end"
            onClick={() => { setRetSearchSerial(''); setRetFilterStatus('all'); setRetFilterReason('all'); setRetFilterVendor('all'); setRetDateFrom(''); setRetDateTo('') }}>
            ✕ Clear
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <PanelHeader title="Purchase Returns" count={filtered.length}>
          {filtered.length !== purchaseReturns.length && (
            <span className="text-[10px] text-t3">{purchaseReturns.length - filtered.length} hidden by filters</span>
          )}
        </PanelHeader>
        <DataTable
          tableId="purchase_returns"
          columns={returnColumns}
          rows={filtered}
          rowKey={r => r.id}
          hideSearch
          emptyMessage="No returns match the filters"
          onRowClick={r => setRetExpandedId(r.id)}
          rowActions={returnRowActions}
          renderCard={r => (
            <RecordCard
              key={r.id}
              eyebrow={r.ref}
              title={r.vendorName}
              subtitle={`PO ${r.poRef}`}
              status={<Badge status={r.status === 'confirmed' ? 'active' : 'pending'} label={r.status} size="xs" />}
              accent={r.status === 'confirmed' ? '#10B981' : '#F59E0B'}
              meta={[
                { label: 'Date', value: fmtDate(r.date) },
                { label: 'Reason', value: REASON_OPTS.find(x => x.value === r.reason)?.label ?? r.reason },
                { label: 'Collected By', value: r.collectedByName ?? 'Not logged' },
                { label: 'Collection', value: r.collectedDate ? fmtDate(r.collectedDate) : '—' },
              ]}
              onClick={() => setRetExpandedId(r.id)}
              actions={returnRowActions(r)}
            />
          )}
          exportTitle="Purchase Returns"
          exportFilename="purchase-returns"
        />
      </div>

      {drawerReturn && (
        <DetailsDrawer
          title={drawerReturn.ref}
          subtitle={`${drawerReturn.vendorName} · PO ${drawerReturn.poRef}`}
          tabs={returnDrawerTabs(drawerReturn)}
          onClose={() => setRetExpandedId(null)}
        />
      )}
    </div>
  )
}
