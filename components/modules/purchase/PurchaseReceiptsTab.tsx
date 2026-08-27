'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { LOCATIONS, type Receipt } from '@/lib/store'
import { receiptSearchBlob, receiptSerialCount } from '@/lib/purchase/receipt-contents'

export default function PurchaseReceiptsTab() {
  const { receipts, fmtDate, openReceiptDetail } = usePurchase()
  const rows = [...receipts].reverse()

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
      render: r => <Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? '✓ Done' : 'Pending'} />,
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
        className="btn-outline text-[10px] py-0.5 px-2"
        onClick={e => { e.stopPropagation(); openReceiptDetail(r.id, 'list') }}
      >
        Open
      </button>
    )
  }

  return (
    <div className="card overflow-hidden purchase-directory purchase-receipts-panel">
      <PanelHeader title="Goods Receipts (GRN)" count={receipts.length} />
      <DataTable
        tableId="purchase_receipts"
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        emptyMessage="No GRNs yet"
        searchPlaceholder="Search receipts by ref, vendor, product, or serial…"
        onRowClick={r => openReceiptDetail(r.id, 'list')}
        rowActions={rowActions}
        renderCard={r => (
          <RecordCard
            key={r.id}
            eyebrow={r.ref}
            title={r.vendorName}
            subtitle={`PO ${r.poRef}${receiptSerialCount(r) ? ` · ${receiptSerialCount(r)} serials` : ''}`}
            status={<Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? 'Done' : 'Pending'} size="xs" />}
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
    </div>
  )
}
