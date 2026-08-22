'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge, Field, Select } from '@/components/ui'
import { DataTable, type ColumnDef, type PrimaryFilterConfig } from '@/components/data-table'
import { CompactInfoNotice, OperationalSummary, TablePageLayout } from '@/components/erp'
import { fmtKes } from '@/lib/store'
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
  const [year, setYear] = useState(String(now.year))
  const [month, setMonth] = useState(String(now.month))
  const [paidFilter, setPaidFilter] = useState<'all' | 'accrued' | 'paid'>('all')
  const [items, setItems] = useState<CommissionRowView[]>([])
  const [summary, setSummary] = useState<CommissionPeriodSummary | null>(null)
  const [closers, setClosers] = useState<CloserSalesRow[]>([])
  const [saleLines, setSaleLines] = useState<CloserSaleLine[]>([])
  const [salesSummary, setSalesSummary] = useState({ salesCount: 0, saleAmount: 0, commissionAmount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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

  const columns: ColumnDef<CommissionRowView>[] = [
    {
      key: 'employee', label: 'Salesperson', priority: 1, width: 'minmax(8rem, 1.3fr)',
      render: row => <span className="text-xs font-medium text-[var(--text-1)] truncate">{row.employeeName}</span>,
      accessor: row => row.employeeName,
    },
    {
      key: 'invoice', label: 'Invoice', priority: 1, width: '120px',
      render: row => row.invoiceId ? (
        <Link className="font-mono text-[11px] font-semibold text-primary-600" href={`/finance/invoices/${row.invoiceId}`}>
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
        isLoading={loading}
        error={error}
        emptyMessage="No POS or sale-order sales for this period"
        searchPlaceholder="Search salesperson…"
        hideColumnFilters
        exportTitle="Sales by salesperson"
        exportFilename="salesperson-sales"
      />
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
        rows={saleLines}
        rowKey={row => row.id}
        isLoading={loading}
        emptyMessage="No sales lines this period"
        searchPlaceholder="Search ref, salesperson, or customer…"
        hideColumnFilters
        exportTitle="Salesperson sale lines"
        exportFilename="salesperson-sale-lines"
      />
      <DataTable
        tableId="finance-commissions"
        columns={columns}
        rows={items}
        rowKey={row => row.id}
        isLoading={loading}
        emptyMessage="No commission posted this period — sales above still count"
        searchPlaceholder="Search salesperson or invoice…"
        primaryFilters={paidFilters}
        hideColumnFilters
        exportTitle="Sales commissions"
        exportFilename="sales-commissions"
      />
    </TablePageLayout>
  )
}
