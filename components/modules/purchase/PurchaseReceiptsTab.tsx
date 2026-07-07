'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { LOCATIONS, type Receipt } from '@/lib/store'

export default function PurchaseReceiptsTab() {
  const { receipts, fmtDate } = usePurchase()
  const rows = [...receipts].reverse()

  const columns: ColumnDef<Receipt>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: r => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{r.ref}</span>,
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.6fr',
      render: r => <span className="text-t1">{r.vendorName}</span>,
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

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Goods Receipts (GRN)" count={receipts.length} />
      <DataTable
        tableId="purchase_receipts"
        columns={columns}
        rows={rows}
        rowKey={r => r.id}
        emptyMessage="No GRNs yet"
        renderCard={r => (
          <RecordCard
            key={r.id}
            eyebrow={r.ref}
            title={r.vendorName}
            subtitle={`PO ${r.poRef}`}
            status={<Badge status={r.status === 'validated' ? 'active' : 'pending'} label={r.status === 'validated' ? 'Done' : 'Pending'} size="xs" />}
            accent={r.status === 'validated' ? 'var(--success)' : 'var(--warning)'}
            meta={[
              { label: 'Date', value: fmtDate(r.date) },
              { label: 'Location', value: `${LOCATIONS[r.destinationLocation].icon} ${LOCATIONS[r.destinationLocation].name}` },
            ]}
          />
        )}
        exportTitle="Goods Receipts"
        exportFilename="goods-receipts"
      />
    </div>
  )
}
