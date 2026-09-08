'use client'

import { useMemo, useState } from 'react'
import { useFinanceStore, fmtDate, fmtKes, type RefundPayment } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Modal } from '@/components/ui'
import { useUrlUiState } from '@/hooks/useUrlRecordId'

const refundMethodLabel = (method: string) => {
  if (method === 'mpesa') return 'M-Pesa'
  if (method === 'bank_transfer') return 'Bank transfer'
  if (method === 'cash') return 'Cash'
  return method ? method.replace(/_/g, ' ') : '—'
}

export default function RefundsTab() {
  const { refundPayments } = useFinanceStore()
  const [refundSearch, setRefundSearch] = useUrlUiState('refundQ', '')
  const [refundMethod, setRefundMethod] = useUrlUiState('refundMethod', 'all')
  const [refundFrom, setRefundFrom] = useUrlUiState('refundFrom', '')
  const [refundTo, setRefundTo] = useUrlUiState('refundTo', '')
  const [selectedRefund, setSelectedRefund] = useState<RefundPayment | null>(null)

  const filteredRefunds = useMemo(() => {
    const query = refundSearch.trim().toLowerCase()
    return refundPayments.filter(refund => {
      if (refundMethod !== 'all' && refund.paymentMethod !== refundMethod) return false
      const paymentDate = String(refund.paymentDate || '')
      if (refundFrom && paymentDate < refundFrom) return false
      if (refundTo && paymentDate > refundTo) return false
      if (!query) return true
      return [
        refund.ref,
        refund.rmaRef,
        refund.customerName,
        refund.paymentMethod,
        refund.notes,
      ].some(value => String(value || '').toLowerCase().includes(query))
    })
  }, [refundFrom, refundMethod, refundPayments, refundSearch, refundTo])

  const filteredTotal = useMemo(
    () => filteredRefunds.reduce((sum, refund) => sum + (Number(refund.amount) || 0), 0),
    [filteredRefunds],
  )

  const columns: ColumnDef<RefundPayment>[] = [
    {
      key: 'ref', label: 'Refund', priority: 1, width: '125px',
      render: refund => <span className="font-mono text-[11px] font-semibold text-primary-600">{refund.ref}</span>,
      exportValue: refund => refund.ref,
    },
    {
      key: 'date', label: 'Date', priority: 1, width: '105px',
      render: refund => <span className="text-[11px] text-t2">{refund.paymentDate ? fmtDate(refund.paymentDate) : '—'}</span>,
      exportValue: refund => refund.paymentDate,
    },
    {
      key: 'rma', label: 'RMA', priority: 2, width: '120px',
      render: refund => <span className="font-mono text-[11px] text-t2">{refund.rmaRef || '—'}</span>,
      exportValue: refund => refund.rmaRef || '',
    },
    {
      key: 'customer', label: 'Customer', priority: 1, width: '1.4fr',
      render: refund => <span className="text-xs font-medium text-t1 truncate">{refund.customerName || '—'}</span>,
      exportValue: refund => refund.customerName || '',
    },
    {
      key: 'amount', label: 'Amount', priority: 1, width: '120px', align: 'right',
      render: refund => <span className="font-mono text-[11px] font-semibold">{fmtKes(refund.amount)}</span>,
      exportValue: refund => refund.amount,
    },
    {
      key: 'method', label: 'Method', priority: 2, width: '115px',
      render: refund => <span className="chip text-[10px] capitalize">{refundMethodLabel(refund.paymentMethod)}</span>,
      exportValue: refund => refundMethodLabel(refund.paymentMethod),
    },
    {
      key: 'notes', label: 'Notes', priority: 3, width: '1.2fr',
      render: refund => <span className="text-[11px] text-t3 truncate">{refund.notes || '—'}</span>,
      exportValue: refund => refund.notes || '',
    },
  ]

  const hasFilters = Boolean(refundSearch || refundFrom || refundTo || refundMethod !== 'all')

  const clearFilters = () => {
    setRefundSearch('')
    setRefundMethod('all')
    setRefundFrom('')
    setRefundTo('')
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-6 border-b px-4 py-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Refunds shown</p>
          <p className="text-base font-semibold text-t1">{filteredRefunds.length}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Refund value</p>
          <p className="font-mono text-base font-semibold text-t1">{fmtKes(filteredTotal)}</p>
        </div>
        <p className="max-w-xl text-[11px] text-t3">
          Recorded customer refunds. Approval, payment and posting remain in the originating workflow.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--border-lt)' }}>
        <label className="flex min-w-[230px] flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-t4">Search</span>
          <input
            className="form-input text-[11px]"
            value={refundSearch}
            onChange={event => setRefundSearch(event.target.value)}
            placeholder="Refund, RMA, customer or notes…"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-t4">Method</span>
          <select className="form-select text-[11px]" value={refundMethod} onChange={event => setRefundMethod(event.target.value)}>
            <option value="all">All methods</option>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-t4">From</span>
          <input className="form-input text-[11px]" type="date" value={refundFrom} onChange={event => setRefundFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-t4">To</span>
          <input className="form-input text-[11px]" type="date" value={refundTo} onChange={event => setRefundTo(event.target.value)} />
        </label>
        {hasFilters && (
          <button type="button" className="btn-secondary text-[11px]" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <DataTable
        tableId="finance-refunds"
        columns={columns}
        rows={filteredRefunds}
        rowKey={refund => refund.id}
        onRowClick={refund => setSelectedRefund(refund)}
        rowLabel={refund => `${refund.ref} ${refund.customerName || ''} ${refund.rmaRef || ''}`}
        emptyMessage={refundPayments.length === 0 ? 'No refunds recorded' : 'No refunds match these filters'}
        hideSearch
        exportTitle="Refund payments"
        exportFilename="refunds"
      />

      {selectedRefund && (
        <Modal
          title={`Refund ${selectedRefund.ref}`}
          subtitle={selectedRefund.customerName || 'Recorded refund'}
          onClose={() => setSelectedRefund(null)}
          width={620}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--border-lt)] sm:grid-cols-3">
              <div className="bg-[var(--bg-surface)] p-3">
                <p className="text-[9px] uppercase tracking-wide text-t4">Amount</p>
                <p className="mt-1 font-mono text-sm font-semibold">{fmtKes(selectedRefund.amount)}</p>
              </div>
              <div className="border-t border-[var(--border-lt)] p-3 sm:border-l sm:border-t-0">
                <p className="text-[9px] uppercase tracking-wide text-t4">Payment date</p>
                <p className="mt-1 text-sm font-semibold">{selectedRefund.paymentDate ? fmtDate(selectedRefund.paymentDate) : '—'}</p>
              </div>
              <div className="border-t border-[var(--border-lt)] p-3 sm:border-l sm:border-t-0">
                <p className="text-[9px] uppercase tracking-wide text-t4">Method</p>
                <p className="mt-1 text-sm font-semibold">{refundMethodLabel(selectedRefund.paymentMethod)}</p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-3 text-xs">
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
                <dt className="text-t3">Customer</dt>
                <dd className="font-medium text-t1">{selectedRefund.customerName || '—'}</dd>
                <dt className="text-t3">RMA reference</dt>
                <dd className="font-mono text-t1">{selectedRefund.rmaRef || '—'}</dd>
                <dt className="text-t3">Notes</dt>
                <dd className="text-t2">{selectedRefund.notes || '—'}</dd>
              </dl>
            </div>

            <p className="text-[11px] text-t3">
              This is a read-only record of a completed refund. No financial action is performed from this view.
            </p>

            <div className="flex justify-end">
              <button type="button" className="btn-primary text-[11px]" onClick={() => setSelectedRefund(null)}>
                Back to refunds
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
