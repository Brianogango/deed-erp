'use client'
import { usePurchase } from './PurchaseContext'
import { PanelHeader, RecordCard } from '@/components/ui'
import { EmptyState, StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { LOCATIONS, type Receipt } from '@/lib/store'
import { receiptSearchBlob, receiptSerialCount } from '@/lib/purchase/receipt-contents'

export default function PurchaseReceiptsTab() {
  const { receipts, fmtDate, openReceiptDetail } = usePurchase()
  const rows = [...receipts].reverse()

  const receiptStatus = (r: Receipt) => r.status === 'validated' ? 'done' : 'pending'
  const receiptStatusLabel = (r: Receipt) => r.status === 'validated' ? 'Done' : 'Pending'

  const columns: ColumnDef<Receipt>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: r => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{r.ref}</span>,
      searchValue: r => receiptSearchBlob(r),
      exportValue: r => r.ref,
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.6fr',
      render: r => <span className="text-t1 erp-truncate" title={r.vendorName}>{r.vendorName}</span>,
      exportValue: r => r.vendorName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '100px',
      render: r => <StatusBadge status={receiptStatus(r)} label={receiptStatusLabel(r)} />,
      exportValue: r => r.status,
    },
    {
      key: 'po', label: 'PO', priority: 2, width: '90px',
      render: r => <span className="font-mono text-[10px] text-t3">{r.poRef}</span>,
      exportValue: r => r.poRef,
    },
    {
      key: 'serials', label: 'Serials', priority: 2, width: '80px', align: 'right',
      render: r => {
        const count = receiptSerialCount(r)
        return <span className="font-mono text-[11px] text-t2">{count || '—'}</span>
      },
      exportValue: r => receiptSerialCount(r),
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: r => <span className="text-[11px] text-t3">{fmtDate(r.date)}</span>,
      exportValue: r => r.date,
    },
    {
      key: 'location', label: 'Location', priority: 3, width: '120px',
      render: r => <span className="text-[11px] text-t2">{LOCATIONS[r.destinationLocation].icon} {LOCATIONS[r.destinationLocation].name}</span>,
      exportValue: r => LOCATIONS[r.destinationLocation].name,
    },
  ]

  function rowActions(r: Receipt) {
    return (
      <button
        type="button"
        className="btn-outline min-h-11 md:min-h-8 text-[10px] py-1 px-3"
        aria-label={`Open goods receipt ${r.ref}`}
        onClick={e => { e.stopPropagation(); openReceiptDetail(r.id, 'list') }}
      >
        Open
      </button>
    )
  }

  return (
    <section className="card overflow-hidden purchase-directory purchase-receipts-panel" aria-label="Goods receipts">
      <PanelHeader title="Goods Receipts (GRN)" count={receipts.length} />
      {rows.length === 0 ? (
        <EmptyState
          title="No goods receipts yet"
          description="Validated purchase receipts will appear here with their PO, destination, products and serial details. Create or confirm a purchase order before receiving stock."
          className="m-4"
        />
      ) : (
        <DataTable
          tableId="purchase_receipts"
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          emptyMessage="No receipts match the current search or filters"
          searchPlaceholder="Search receipts by ref, vendor, product, or serial…"
          onRowClick={r => openReceiptDetail(r.id, 'list')}
          rowActions={rowActions}
          renderCard={r => (
            <RecordCard
              key={r.id}
              eyebrow={r.ref}
              title={r.vendorName}
              subtitle={`PO ${r.poRef}${receiptSerialCount(r) ? ` · ${receiptSerialCount(r)} serials` : ''}`}
              status={<StatusBadge status={receiptStatus(r)} label={receiptStatusLabel(r)} />}
              accent={r.status === 'validated' ? 'var(--success)' : 'var(--warning)'}
              meta={[
                { label: 'Date', value: fmtDate(r.date) },
                { label: 'Location', value: `${LOCATIONS[r.destinationLocation].icon} ${LOCATIONS[r.destinationLocation].name}` },
                { label: 'Serials', value: receiptSerialCount(r) || 'None' },
              ]}
              actions={rowActions(r)}
              onClick={() => openReceiptDetail(r.id, 'list')}
            />
          )}
          exportTitle="Goods Receipts"
          exportFilename="goods-receipts"
        />
      )}
    </section>
  )
}
