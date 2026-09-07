'use client'
import { useRouter } from 'next/navigation'
import { usePurchase } from './PurchaseContext'
import { PanelHeader, RecordCard } from '@/components/ui'
import { AsyncActionButton, EmptyState, StatusBadge } from '@/components/erp'
import { DataTable, type ColumnDef } from '@/components/data-table'
import type { Invoice } from '@/lib/store'
import { invoiceDocState, invoicePaymentStatus, displayDocRef, PAYMENT_STATUS_LABELS } from '@/lib/odoo-sales-flow'
import { financeInvoicePath } from '@/lib/finance-invoice'

type VendorBill = Invoice

export default function PurchaseBillsTab() {
  const router = useRouter()
  const {
    vendorBills, purchaseOrders, postInvoice, currentUser,
    fmtKes, fmtDate,
  } = usePurchase()
  const canValidateBills = ['director', 'finance_officer', 'admin_officer'].includes(currentUser?.role ?? '')

  const linkedPORef = (b: VendorBill) => b.purchaseOrderId ? (purchaseOrders.find(p => p.id === b.purchaseOrderId)?.ref ?? '—') : '—'
  const billStatus = (b: VendorBill) => invoiceDocState(b.status) === 'posted' ? invoicePaymentStatus(b) : invoiceDocState(b.status)
  const billStatusLabel = (b: VendorBill) => invoiceDocState(b.status) === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(b)] : undefined
  const isDraftBill = (b: VendorBill) => invoiceDocState(b.status) === 'draft'
  const openBill = (b: VendorBill) => router.push(financeInvoicePath(b.id))

  const columns: ColumnDef<VendorBill>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '90px',
      render: b => (
        <button
          type="button"
          className="font-mono text-[11px] font-semibold hover:underline text-left"
          style={{ color: 'var(--navy)' }}
          onClick={e => { e.stopPropagation(); openBill(b) }}
          aria-label={`Open vendor bill ${displayDocRef(b.ref)}`}
        >
          {displayDocRef(b.ref)}
        </button>
      ),
    },
    {
      key: 'vendor', label: 'Vendor', priority: 1, width: '1.4fr',
      render: b => <span className="text-t1 erp-truncate" title={b.partnerName}>{b.partnerName}</span>,
      exportValue: b => b.partnerName,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '100px',
      render: b => <StatusBadge status={billStatus(b)} label={billStatusLabel(b)} />,
      exportValue: b => invoiceDocState(b.status) === 'posted' ? PAYMENT_STATUS_LABELS[invoicePaymentStatus(b)] : invoiceDocState(b.status),
    },
    {
      key: 'outstanding', label: 'Outstanding', priority: 1, width: '100px', align: 'right',
      render: b => {
        const outstanding = b.total - b.amountPaid
        return <span className="font-mono text-[11px]" style={{ color: outstanding <= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmtKes(outstanding)}</span>
      },
      exportValue: b => b.total - b.amountPaid,
      footer: pageRows => (
        <span className="font-mono text-[11px] font-bold tabular-nums">
          {fmtKes(pageRows.reduce((sum, bill) => sum + Math.max(0, bill.total - bill.amountPaid), 0))}
        </span>
      ),
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
      footer: pageRows => (
        <span className="font-mono text-[11px] font-bold tabular-nums">
          {fmtKes(pageRows.reduce((sum, bill) => sum + bill.total, 0))}
        </span>
      ),
    },
    {
      key: 'paid', label: 'Paid', priority: 3, width: '90px', align: 'right',
      render: b => <span className="font-mono text-[11px]" style={{ color: 'var(--success)' }}>{fmtKes(b.amountPaid)}</span>,
      exportValue: b => b.amountPaid,
      footer: pageRows => (
        <span className="font-mono text-[11px] font-bold tabular-nums">
          {fmtKes(pageRows.reduce((sum, bill) => sum + bill.amountPaid, 0))}
        </span>
      ),
    },
  ]

  function validateAction(b: VendorBill, compact = false) {
    return (
      <AsyncActionButton
        className={`btn-primary ${compact ? 'min-h-9 text-[9px] py-0.5 px-2' : 'min-h-11 text-[10px] py-1.5 px-3'}`}
        style={{ background: 'var(--success)' }}
        action={() => Promise.resolve(postInvoice(b.id))}
        pendingLabel="Validating…"
        onClickCapture={compact ? e => e.stopPropagation() : undefined}
      >
        Validate
      </AsyncActionButton>
    )
  }

  function rowActions(b: VendorBill) {
    const outstanding = b.total - b.amountPaid
    return (
      <>
        {isDraftBill(b) && canValidateBills && validateAction(b, true)}
        {invoiceDocState(b.status) === 'posted' && outstanding > 0 && (
          <span className="text-[9px] text-[var(--text-4)] italic">Pay via Finance</span>
        )}
      </>
    )
  }

  return (
    <section className="card overflow-hidden purchase-directory purchase-bills-panel" aria-label="Vendor bills">
      <PanelHeader title="Vendor Bills" count={vendorBills.length} />
      {vendorBills.length === 0 ? (
        <EmptyState
          title="No vendor bills yet"
          description="Vendor bills created from purchase orders will appear here for validation and payment tracking. Receive the goods and create the bill from the related purchase order when ready."
          className="m-4"
        />
      ) : (
        <DataTable
          tableId="vendor_bills"
          columns={columns}
          rows={vendorBills}
          rowKey={b => b.id}
          emptyMessage="No vendor bills match the current search or filters"
          onRowClick={openBill}
          rowActions={rowActions}
          renderCard={b => (
            <RecordCard
              key={b.id}
              eyebrow={displayDocRef(b.ref)}
              title={b.partnerName}
              subtitle={`PO ${linkedPORef(b)}`}
              amount={fmtKes(b.total - b.amountPaid)}
              status={<StatusBadge status={billStatus(b)} label={billStatusLabel(b)} />}
              accent={(b.total - b.amountPaid) > 0 ? 'var(--danger)' : 'var(--success)'}
              meta={[
                { label: 'Due', value: fmtDate(b.dueDate) },
                { label: 'Total', value: fmtKes(b.total) },
                { label: 'Paid', value: fmtKes(b.amountPaid) },
                { label: 'Outstanding', value: fmtKes(b.total - b.amountPaid) },
              ]}
              actions={isDraftBill(b) && canValidateBills ? validateAction(b) : undefined}
            />
          )}
          exportTitle="Vendor Bills"
          exportFilename="vendor-bills"
        />
      )}
    </section>
  )
}
