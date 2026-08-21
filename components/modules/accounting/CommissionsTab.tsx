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
    fetch(`/api/sales-commissions?${params}`)
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`)
        const rows: CommissionRowView[] = Array.isArray(data?.items) ? data.items : []
        setItems(rows)
        setSummary(data?.summary ?? summarizeCommissions(rows))
      })
      .catch(err => {
        setItems([])
        setSummary(null)
        setError(err instanceof Error ? err.message : 'Could not load commissions')
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
      title="Commissions"
      summary={
        <OperationalSummary
          items={[
            { id: 'sale', label: 'posted sale', value: fmtKes(summary?.saleAmount ?? 0) },
            { id: 'accrued', label: 'accrued', value: fmtKes(summary?.accrued ?? 0), tone: (summary?.accrued ?? 0) > 0 ? 'warning' : 'default' },
            { id: 'paid', label: 'paid', value: fmtKes(summary?.paid ?? 0), tone: 'success' },
          ]}
        />
      }
      notice={
        <CompactInfoNotice>
          Earned when a customer invoice is posted — not when a quote is saved. Set category rates in{' '}
          <Link href="/settings?tab=sales" className="underline">Settings → Sales</Link>
          . Closers need an HR employee on their login.
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
        tableId="finance-commissions"
        columns={columns}
        rows={items}
        rowKey={row => row.id}
        isLoading={loading}
        error={error}
        emptyMessage="No commission posted this period"
        searchPlaceholder="Search salesperson or invoice…"
        primaryFilters={paidFilters}
        hideColumnFilters
        exportTitle="Sales commissions"
        exportFilename="sales-commissions"
      />
    </TablePageLayout>
  )
}
