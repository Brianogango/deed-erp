'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, Field, Modal, Select } from '@/components/ui'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { CompactInfoNotice, OperationalSummary, TablePageLayout } from '@/components/erp'
import { fmtDate, fmtKes } from '@/lib/store'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
import {
  summarizeCommissions,
  type CommissionPeriodSummary,
  type CommissionRowView,
} from '@/lib/accounting/sales-commission-view'

type CloserSalesRow = {
  closerId: string
  closerName: string
  employeeId?: string
  salesCount: number
  saleAmount: number
  commissionAmount: number
}

type CloserSaleLine = {
  id: string
  ref: string
  source: 'sale_order' | 'pos'
  date: string
  customerName: string
  total: number
  closerId: string
  closerName: string
}

function currentPeriod() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function monthOptions() {
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2026, i, 1).toLocaleDateString('en-KE', { month: 'long' }),
  }))
}

function yearOptions() {
  const y = new Date().getFullYear()
  return [y, y - 1, y - 2].map(year => ({ value: String(year), label: String(year) }))
}

export default function CommissionsTab() {
  const now = currentPeriod()
  const [year, setYear] = useUrlUiState('commissionYear', String(now.year))
  const [month, setMonth] = useUrlUiState('commissionMonth', String(now.month))
  const [paidFilterValue, setPaidFilter] = useUrlUiState('commissionStatus', 'all')
  const paidFilter = (['all', 'accrued', 'paid'].includes(paidFilterValue) ? paidFilterValue : 'all') as 'all' | 'accrued' | 'paid'
  const [selectedCloser, setSelectedCloser] = useState<CloserSalesRow | null>(null)
  const [selectedCommission, setSelectedCommission] = useState<CommissionRowView | null>(null)
  const [items, setItems] = useState<CommissionRowView[]>([])
  const [summary, setSummary] = useState<CommissionPeriodSummary | null>(null)
  const [closers, setClosers] = useState<CloserSalesRow[]>([])
  const [saleLines, setSaleLines] = useState<CloserSaleLine[]>([])
  const [salesSummary, setSalesSummary] = useState({ salesCount: 0, saleAmount: 0, commissionAmount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedCloser(null)
    setSelectedCommission(null)
    const params = new URLSearchParams({
      summary: '1',
      periodYear: year,
      periodMonth: month,
    })
    if (paidFilter === 'accrued') params.set('isPaid', 'false')
    if (paidFilter === 'paid') params.set('isPaid', 'true')
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/api/sales-commissions?${params}`).then(async res => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`)
        return data
      }),
      fetch(`/api/salesperson-sales?periodYear=${year}&periodMonth=${month}`).then(async res => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`)
        return data
      }),
    ])
      .then(([commissionData, salesData]) => {
        const rows: CommissionRowView[] = Array.isArray(commissionData?.items) ? commissionData.items : []
        setItems(rows)
        setSummary(commissionData?.summary ?? summarizeCommissions(rows))
        setClosers(Array.isArray(salesData?.byCloser) ? salesData.byCloser : [])
        setSaleLines(Array.isArray(salesData?.items) ? salesData.items : [])
        setSalesSummary({
          salesCount: Number(salesData?.summary?.salesCount) || 0,
          saleAmount: Number(salesData?.summary?.saleAmount) || 0,
          commissionAmount: Number(salesData?.summary?.commissionAmount) || 0,
        })
      })
      .catch(err => {
        setItems([])
        setSummary(null)
        setClosers([])
        setSaleLines([])
        setSalesSummary({ salesCount: 0, saleAmount: 0, commissionAmount: 0 })
        setError(err instanceof Error ? err.message : 'Could not load salesperson sales')
      })
      .finally(() => setLoading(false))
  }, [year, month, paidFilter])

  const visibleSaleLines = useMemo(
    () => selectedCloser ? saleLines.filter(line => line.closerId === selectedCloser.closerId) : saleLines,
    [saleLines, selectedCloser],
  )

  const columns: ColumnDef<CommissionRowView>[] = [
    {
      key: 'employee', label: 'Salesperson', priority: 1, width: 'minmax(8rem, 1.3fr)',
      render: row => <span className="text-xs font-medium text-[var(--text-1)] truncate">{row.employeeName}</span>,
      accessor: row => row.employeeName,
    },
    {
      key: 'invoice', label: 'Invoice', priority: 1, width: '120px',
      render: row => row.invoiceId ? (
        <Link className="font-mono text-[11px] font-semibold text-primary-600" href={`/finance/invoices/${row.invoiceId}`} onClick={event => event.stopPropagation()}>
          {row.invoiceRef || 'Invoice'}
        </Link>
      ) : <span className="text-[11px] text-[var(--text-3)]">—</span>,
      accessor: row => row.invoiceRef ?? '',
    },
    {
      key: 'sale', label: 'Sale amount', priority: 1, width: '120px', align: 'right',
      render: row => <span className="font-mono text-[11px] tabular-nums">{fmtKes(row.saleAmount)}</span>,
      exportValue: row => row.saleAmount,
    },
    {
      key: 'rate', label: 'Rate', priority: 2, width: '80px', align: 'right',
      render: row => <span className="text-[11px] tabular-nums">{row.commissionRate}%</span>,
      exportValue: row => row.commissionRate,
    },
    {
      key: 'commission', label: 'Commission', priority: 1, width: '120px', align: 'right',
      render: row => <span className="font-mono text-[11px] font-semibold tabular-nums">{fmtKes(row.commissionAmount)}</span>,
      exportValue: row => row.commissionAmount,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '100px',
      render: row => <Badge status={row.isPaid ? 'paid' : 'pending'} label={row.isPaid ? 'paid' : 'accrued'} size="xs" />,
      accessor: row => row.isPaid ? 'paid' : 'accrued',
    },
  ]

  const paidFilters: PrimaryFilterConfig[] = [
    {
      key: 'status',
      label: 'Status',
      placeholder: 'All',
      value: paidFilter,
      options: [
        { value: 'all', label: 'All' },
        { value: 'accrued', label: 'Accrued' },
        { value: 'paid', label: 'Paid' },
      ],
      onChange: value => setPaidFilter((value as 'all' | 'accrued' | 'paid') || 'all'),
    },
  ]

  return (
    <TablePageLayout
      title="Salespeople"
      summary={
        <OperationalSummary
          items={[
            { id: 'sales', label: 'sales', value: String(salesSummary.salesCount) },
            { id: 'sale', label: 'sales total', value: fmtKes(salesSummary.saleAmount) },
            { id: 'commission', label: 'commission', value: fmtKes(salesSummary.commissionAmount || summary?.commissionAmount || 0) },
            { id: 'accrued', label: 'accrued', value: fmtKes(summary?.accrued ?? 0), tone: (summary?.accrued ?? 0) > 0 ? 'warning' : 'default' },
          ]}
        />
      }
      notice={
        <CompactInfoNotice>
          Every POS ticket and confirmed sale order is counted against the closer, even when commission is zero. Commission posts only after a product or category rate is set in{' '}
          <Link href="/settings?tab=sales" className="underline">Settings → Sales</Link>
          .
        </CompactInfoNotice>
      }
    >
      <div className="flex flex-wrap gap-3 px-4 pt-3">
        <Field label="Month">
          <Select value={month} onChange={setMonth} options={monthOptions()} />
        </Field>
        <Field label="Year">
          <Select value={year} onChange={setYear} options={yearOptions()} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-lt)] px-4 pb-2 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-t1">Salespeople overview</h3>
          <p className="text-[11px] text-t3">Select a salesperson to focus the sales records below.</p>
        </div>
        <span className="text-[10px] text-t3">{closers.length} salesperson{closers.length === 1 ? '' : 's'}</span>
      </div>
      <DataTable
        tableId="finance-salesperson-totals"
        columns={[
          {
            key: 'closer', label: 'Salesperson', priority: 1, width: 'minmax(8rem, 1.4fr)',
            render: row => <span className="text-xs font-medium text-[var(--text-1)] truncate">{row.closerName}</span>,
            accessor: row => row.closerName,
          },
          {
            key: 'count', label: 'Sales', priority: 1, width: '80px', align: 'right',
            render: row => <span className="tabular-nums text-[11px]">{row.salesCount}</span>,
            exportValue: row => row.salesCount,
          },
          {
            key: 'total', label: 'Sales total', priority: 1, width: '130px', align: 'right',
            render: row => <span className="font-mono text-[11px] font-semibold tabular-nums">{fmtKes(row.saleAmount)}</span>,
            exportValue: row => row.saleAmount,
          },
          {
            key: 'commission', label: 'Commission', priority: 1, width: '120px', align: 'right',
            render: row => <span className="font-mono text-[11px] tabular-nums">{fmtKes(row.commissionAmount)}</span>,
            exportValue: row => row.commissionAmount,
          },
        ] as ColumnDef<CloserSalesRow>[]}
        rows={closers}
        rowKey={row => row.closerId}
        onRowClick={row => setSelectedCloser(row)}
        rowLabel={row => `${row.closerName}: ${row.salesCount} sales, ${fmtKes(row.commissionAmount)} commission`}
        isLoading={loading}
        error={error}
        emptyMessage="No POS or sale-order sales for this period"
        searchPlaceholder="Search salesperson…"
        hideColumnFilters
        exportTitle="Sales by salesperson"
        exportFilename="salesperson-sales"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-lt)] px-4 pb-2 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-t1">{selectedCloser ? `${selectedCloser.closerName}'s sales` : 'Sales records'}</h3>
          <p className="text-[11px] text-t3">
            {selectedCloser ? `${visibleSaleLines.length} record${visibleSaleLines.length === 1 ? '' : 's'} for the selected salesperson.` : 'Every POS ticket and confirmed sale order attributed to a closer.'}
          </p>
        </div>
        {selectedCloser && (
          <button type="button" className="btn-secondary text-[11px]" onClick={() => setSelectedCloser(null)}>
            Show all salespeople
          </button>
        )}
      </div>
      <DataTable
        tableId="finance-salesperson-lines"
        columns={[
          {
            key: 'ref', label: 'Ref', priority: 1, width: '120px',
            render: row => <span className="font-mono text-[11px] font-semibold">{row.ref}</span>,
            accessor: row => row.ref,
          },
          {
            key: 'source', label: 'Source', priority: 2, width: '90px',
            render: row => <span className="text-[11px] text-[var(--text-3)]">{row.source === 'pos' ? 'POS' : 'Sale order'}</span>,
            exportValue: row => row.source,
          },
          {
            key: 'closer', label: 'Salesperson', priority: 1, width: 'minmax(8rem, 1.2fr)',
            render: row => <span className="text-xs truncate">{row.closerName}</span>,
            accessor: row => row.closerName,
          },
          {
            key: 'customer', label: 'Customer', priority: 1, width: 'minmax(8rem, 1.3fr)',
            render: row => <span className="text-[11px] text-[var(--text-3)] truncate">{row.customerName}</span>,
            accessor: row => row.customerName,
          },
          {
            key: 'date', label: 'Date', priority: 2, width: '110px',
            render: row => <span className="text-[11px] text-[var(--text-3)]">{row.date}</span>,
            exportValue: row => row.date,
          },
          {
            key: 'total', label: 'Total', priority: 1, width: '120px', align: 'right',
            render: row => <span className="font-mono text-[11px] font-semibold tabular-nums">{fmtKes(row.total)}</span>,
            exportValue: row => row.total,
          },
        ] as ColumnDef<CloserSaleLine>[]}
        rows={visibleSaleLines}
        rowKey={row => row.id}
        isLoading={loading}
        emptyMessage="No sales lines this period"
        searchPlaceholder="Search ref, salesperson, or customer…"
        hideColumnFilters
        exportTitle="Salesperson sale lines"
        exportFilename="salesperson-sale-lines"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-lt)] px-4 pb-2 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-t1">Posted commission records</h3>
          <p className="text-[11px] text-t3">Commission earned from posted customer invoices for the selected period.</p>
        </div>
        <span className="text-[10px] text-t3">{items.length} record{items.length === 1 ? '' : 's'}</span>
      </div>
      <DataTable
        tableId="finance-commissions"
        columns={columns}
        rows={items}
        rowKey={row => row.id}
        onRowClick={row => setSelectedCommission(row)}
        rowLabel={row => `${row.employeeName} ${row.invoiceRef || ''} ${row.isPaid ? 'paid' : 'accrued'}`}
        isLoading={loading}
        emptyMessage="No commission posted this period — sales above still count"
        searchPlaceholder="Search salesperson or invoice…"
        primaryFilters={paidFilters}
        hideColumnFilters
        exportTitle="Sales commissions"
        exportFilename="sales-commissions"
      />

      {selectedCommission && (
        <Modal
          title="Commission record"
          subtitle={selectedCommission.invoiceRef || selectedCommission.employeeName}
          onClose={() => setSelectedCommission(null)}
          width={620}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--border-lt)] sm:grid-cols-3">
              <div className="bg-[var(--bg-surface)] p-3">
                <p className="text-[9px] uppercase tracking-wide text-t4">Commission</p>
                <p className="mt-1 font-mono text-sm font-semibold">{fmtKes(selectedCommission.commissionAmount)}</p>
              </div>
              <div className="border-t border-[var(--border-lt)] p-3 sm:border-l sm:border-t-0">
                <p className="text-[9px] uppercase tracking-wide text-t4">Sale amount</p>
                <p className="mt-1 font-mono text-sm font-semibold">{fmtKes(selectedCommission.saleAmount)}</p>
              </div>
              <div className="border-t border-[var(--border-lt)] p-3 sm:border-l sm:border-t-0">
                <p className="text-[9px] uppercase tracking-wide text-t4">Status</p>
                <div className="mt-1">
                  <Badge status={selectedCommission.isPaid ? 'paid' : 'pending'} label={selectedCommission.isPaid ? 'paid' : 'accrued'} size="xs" />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] px-3 py-3 text-xs">
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
                <dt className="text-t3">Salesperson</dt>
                <dd className="font-medium text-t1">{selectedCommission.employeeName}</dd>
                <dt className="text-t3">Invoice</dt>
                <dd className="font-mono text-t1">{selectedCommission.invoiceRef || '—'}</dd>
                <dt className="text-t3">Rate</dt>
                <dd className="text-t1">{selectedCommission.commissionRate}%</dd>
                <dt className="text-t3">Period</dt>
                <dd className="text-t1">{monthOptions()[selectedCommission.periodMonth - 1]?.label || selectedCommission.periodMonth} {selectedCommission.periodYear}</dd>
                {selectedCommission.createdAt && (
                  <>
                    <dt className="text-t3">Posted</dt>
                    <dd className="text-t1">{fmtDate(selectedCommission.createdAt)}</dd>
                  </>
                )}
              </dl>
            </div>

            <p className="text-[11px] text-t3">
              This detail is read-only. Commission calculation, payment status, posting and approval remain in their existing workflows.
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              {selectedCommission.invoiceId && (
                <Link className="btn-primary text-[11px]" href={`/finance/invoices/${selectedCommission.invoiceId}`}>
                  Open invoice
                </Link>
              )}
              <button type="button" className={selectedCommission.invoiceId ? 'btn-secondary text-[11px]' : 'btn-primary text-[11px]'} onClick={() => setSelectedCommission(null)}>
                Back to commissions
              </button>
            </div>
          </div>
        </Modal>
      )}
    </TablePageLayout>
  )
}
