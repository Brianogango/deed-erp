'use client'

import { useMemo } from 'react'
import { useFinanceStore, fmtDate, fmtKes } from '@/lib/store'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { faCreditCard } from '@fortawesome/free-solid-svg-icons'
import { EmptyState, StatusBadge } from '@/components/erp'
import {
  customerCreditSourceLabel,
  customerCreditStatusLabel,
  totalOpenStoreCredit,
  type CustomerCreditLike,
} from '@/lib/customer-credit-view'

export default function CustomerCreditsTab() {
  const { customerCredits } = useFinanceStore()
  const openTotal = useMemo(() => totalOpenStoreCredit(customerCredits), [customerCredits])
  const clientsWithCredit = useMemo(() => {
    const ids = new Set(
      customerCredits
        .filter(c => c.status === 'available' || c.status === 'partially_used')
        .filter(c => (Number(c.balance) || 0) > 0)
        .map(c => c.customerId),
    )
    return ids.size
  }, [customerCredits])

  const columns: ColumnDef<CustomerCreditLike>[] = [
    {
      key: 'ref', label: 'Credit', priority: 1, width: '120px',
      render: c => <span className="font-mono text-[11px] font-semibold text-primary-600">{c.ref}</span>,
      exportValue: c => c.ref ?? '',
    },
    {
      key: 'customer', label: 'Client', priority: 1, width: '1.4fr',
      render: c => <span className="text-xs font-medium text-t1 truncate">{c.customerName || '—'}</span>,
      exportValue: c => c.customerName ?? '',
    },
    {
      key: 'source', label: 'Source', priority: 2, width: '1.2fr',
      render: c => <span className="text-[11px] text-t2 truncate">{customerCreditSourceLabel(c)}</span>,
      exportValue: c => customerCreditSourceLabel(c),
    },
    {
      key: 'date', label: 'Date', priority: 3, width: '100px',
      render: c => <span className="text-[11px] text-t3">{c.createdAt ? fmtDate(c.createdAt) : '—'}</span>,
      exportValue: c => c.createdAt ?? '',
    },
    {
      key: 'amount', label: 'Issued', priority: 2, width: '110px', align: 'right',
      render: c => <span className="font-mono text-[11px]">{fmtKes(c.amount)}</span>,
      exportValue: c => c.amount ?? 0,
    },
    {
      key: 'balance', label: 'Remaining', priority: 1, width: '110px', align: 'right',
      render: c => (
        <span className="font-mono text-[11px] font-semibold" style={{ color: (Number(c.balance) || 0) > 0 ? 'var(--success)' : 'var(--text-3)' }}>
          {fmtKes(c.balance)}
        </span>
      ),
      exportValue: c => c.balance ?? 0,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '110px',
      render: c => (
        <StatusBadge
          status={c.status === 'available' ? 'active' : c.status === 'partially_used' ? 'warning' : c.status === 'void' ? 'cancelled' : 'draft'}
          label={customerCreditStatusLabel(c.status)}
          size="xs"
        />
      ),
      accessor: c => c.status,
      exportValue: c => customerCreditStatusLabel(c.status),
    },
  ]

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap gap-6 border-b px-4 py-3" style={{ borderColor: 'var(--border-lt)', background: 'var(--bg-surface)' }}>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Open store credit</p>
          <p className="font-mono text-base font-semibold" style={{ color: openTotal > 0 ? 'var(--success)' : 'var(--text-1)' }}>{fmtKes(openTotal)}</p>
        </div>
        <div>
          <p className="mb-0.5 text-[10px] text-t3">Clients with credit</p>
          <p className="text-base font-semibold text-t1">{clientsWithCredit}</p>
        </div>
        <p className="max-w-xl self-center text-[11px] text-t3">
          Credit from buy-backs, returns, and cancelled paid invoices. Apply it on a posted unpaid invoice.
        </p>
      </div>

      {customerCredits.length === 0 ? (
        <EmptyState
          title="No customer credits yet"
          description="Credits will appear here after an After-Sales buy-back is added as credit or a credit note is issued on a posted invoice."
          icon={<Fa icon={faCreditCard} />}
          className="m-4"
        />
      ) : (
        <DataTable
          tableId="customer-credits"
          columns={columns}
          rows={customerCredits}
          rowKey={c => String(c.id || c.ref)}
          emptyMessage="No credits match"
          searchPlaceholder="Search client or credit ref…"
          exportTitle="Customer store credit"
          exportFilename="customer-credits"
        />
      )}
    </div>
  )
}
