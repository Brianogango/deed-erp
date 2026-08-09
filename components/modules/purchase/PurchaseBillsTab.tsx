'use client'
import { usePurchase } from './PurchaseContext'
import { Badge, PanelHeader, RecordCard } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import type { Invoice } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, displayDocRef, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'

type VendorBill = Invoice

export default function PurchaseBillsTab() {
  const {
    vendorBills, purchaseOrders, postInvoice, currentUser,
    fmtKes, fmtDate,
  } = usePurchase()
  // admin_officer is deliberately excluded: postInvoice's actual gate
  // (canPostOrPayCustomerInvoice) only allows Admin Officer to post/pay
  // customer_invoice documents up to a threshold — vendor bills always
  // require director/finance_officer. Showing "Validate" here to
  // admin_officer was a guaranteed-denied dead end.
  const canValidateBills = ['director', 'finance_officer'].includes(currentUser?.role ?? '')

  const linkedPORef = (b: VendorBill) => b.purchaseOrderId ? (purchaseOrders.find(p => p.id === b.purchaseOrderId)?.ref ?? '—') : '—'

  const columns: ColumnDef<VendorBill>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: b => <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>{displayDocRef(b.ref)}</span>,
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.4fr',
      render: b => <span className="text-t1 erp-truncate" title={b.partnerName}>{b.partnerName}</span>,
      exportValue: b => b.partnerName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '100px',
      render: b => <Badge status={invoiceDocState(b.status) === 'posted' ? invoicePaymentStatus(b) : invoiceDocState(b.status)} label={invoiceDocState(b.status) === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(b)] : undefined} size="xs" />,
      exportValue: b => invoiceDocState(b.status) === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(b)] : invoiceDocState(b.status),
    },
    {
      key: 'outstanding', label: 'Outstanding', priority: 1, width: '100px', align: 'right',
      render: b => {
        const outstanding = b.total - b.amountPaid
        return <span className="font-mono text-[11px]" style={{ color: outstanding <= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtKes(outstanding)}</span>
      },
      exportValue: b => b.total - b.amountPaid,
    },
    {
      key: 'po', label: 'PO', priority: 2, width: '90px',
      render: b => <span className="font-mono text-[10px] text-t3">{linkedPORef(b)}</span>,
      exportValue: b => linkedPORef(b),
    },
    {
      key: 'dueDate', label: 'Due Date', priority: 2, width: '100px',
      render: b => <span className="text-[11px] text-t3">{fmtDate(b.dueDate)}</span>,
      exportValue: b => b.dueDate,
    },
    {
      key: 'total', label: 'Total', priority: 2, width: '90px', align: 'right',
      render: b => <span className="font-mono text-[11px] text-t1">{fmtKes(b.total)}</span>,
      exportValue: b => b.total,
    },
    {
      key: 'paid', label: 'Paid', priority: 3, width: '90px', align: 'right',
      render: b => <span className="font-mono text-[11px]" style={{ color: 'var(--success)' }}>{fmtKes(b.amountPaid)}</span>,
      exportValue: b => b.amountPaid,
    },
  ]

  function rowActions(b: VendorBill) {
    const outstanding = b.total - b.amountPaid
    return (
      <>
        {b.status === 'draft' && canValidateBills && (
          <button className="btn-primary text-[9px] py-0.5 px-2" style={{ background: 'var(--success)' }}
            onClick={e => { e.stopPropagation(); postInvoice(b.id) }}>Validate</button>
        )}
        {invoiceDocState(b.status) === 'posted' && outstanding > 0 && (
          <span className="text-[9px] text-[var(--text-4)] italic">Pay via Finance</span>
        )}
      </>
    )
  }

  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Vendor Bills" count={vendorBills.length} />
      <DataTable
        tableId="vendor_bills"
        columns={columns}
        rows={vendorBills}
        rowKey={b => b.id}
        emptyMessage="No vendor bills yet"
        rowActions={rowActions}
        renderCard={b => (
          <RecordCard
            key={b.id}
            eyebrow={displayDocRef(b.ref)}
            title={b.partnerName}
            subtitle={`PO ${linkedPORef(b)}`}
            amount={fmtKes(b.total - b.amountPaid)}
            status={<Badge status={invoiceDocState(b.status) === 'posted' ? invoicePaymentStatus(b) : invoiceDocState(b.status)} label={invoiceDocState(b.status) === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(b)] : undefined} size="xs" />}
            accent={(b.total - b.amountPaid) > 0 ? 'var(--danger)' : 'var(--success)'}
            meta={[
              { label: 'Due', value: fmtDate(b.dueDate) },
              { label: 'Total', value: fmtKes(b.total) },
              { label: 'Paid', value: fmtKes(b.amountPaid) },
              { label: 'Outstanding', value: fmtKes(b.total - b.amountPaid) },
            ]}
            actions={b.status === 'draft' && canValidateBills ? (
              <button className="btn-primary text-[10px] py-1.5 px-3" style={{ background: 'var(--success)' }} onClick={() => postInvoice(b.id)}>Validate</button>
            ) : undefined}
          />
        )}
        exportTitle="Vendor Bills"
        exportFilename="vendor-bills"
      />
    </div>
  )
}
