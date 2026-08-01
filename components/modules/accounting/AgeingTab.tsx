'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { DataTable } from '@/components/data-table'
import { fmtDate, fmtKes, type Invoice } from '@/lib/store'
import { bucketOpenInvoices, type AgeingRow } from '@/lib/accounting/ageing'

type ViewMode = 'invoices' | 'partners'

function AgeingReport({
  title,
  kind,
  invoices,
  asOf,
}: {
  title: string
  kind: 'ar' | 'ap'
  invoices: Invoice[]
  asOf: string
}) {
  const [mode, setMode] = useState<ViewMode>('partners')
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null)

  const report = useMemo(
    () => bucketOpenInvoices(invoices, asOf || new Date().toISOString().slice(0, 10)),
    [invoices, asOf],
  )

  const invoiceRows = useMemo(() => {
    if (!partnerFilter) return report.rows
    return report.rows.filter(r => (r.partnerId || r.partnerName) === partnerFilter)
  }, [report.rows, partnerFilter])

  const totals = partnerFilter
    ? invoiceRows.reduce((a, r) => ({
        balance: a.balance + r.balance,
        current: a.current + r.current,
        d30: a.d30 + r.d30,
        d60: a.d60 + r.d60,
        d90: a.d90 + r.d90,
        over90: a.over90 + r.over90,
      }), { balance: 0, current: 0, d30: 0, d60: 0, d90: 0, over90: 0 })
    : report.totals

  const invoiceHref = (id: string) => `/finance/invoices/${id}`

  const partnerTableRows = [
    ...report.partners.map(p => ({ ...p, id: p.partnerId })),
    {
      id: '__totals__',
      partnerId: '__totals__',
      partnerName: 'Totals',
      invoiceCount: report.rows.length,
      balance: report.totals.balance,
      current: report.totals.current,
      d30: report.totals.d30,
      d60: report.totals.d60,
      d90: report.totals.d90,
      over90: report.totals.over90,
      invoiceIds: [] as string[],
    },
  ]

  const invoiceTableRows = [
    ...invoiceRows,
    {
      id: '__totals__',
      ref: '',
      partnerName: 'Totals',
      dueDate: '',
      daysPastDue: 0,
      balance: totals.balance,
      current: totals.current,
      d30: totals.d30,
      d60: totals.d60,
      d90: totals.d90,
      over90: totals.over90,
      bucket: 'current' as const,
    } satisfies AgeingRow & { id: string },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-[var(--text-1)]">{title}</h2>
          <p className="text-[11px] text-[var(--text-3)]">
            {kind === 'ar' ? 'Customer invoices' : 'Vendor bills'} aged by days past due
            {partnerFilter ? ' · filtered partner' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-[var(--text-3)]">Total: {fmtKes(totals.balance)}</span>
          <div className="flex rounded-lg border border-[var(--border-lt)] overflow-hidden text-[11px]">
            <button
              type="button"
              className={`px-2.5 py-1.5 ${mode === 'partners' ? 'bg-[var(--bg-muted)] font-bold' : ''}`}
              onClick={() => { setMode('partners'); setPartnerFilter(null) }}
            >
              By partner
            </button>
            <button
              type="button"
              className={`px-2.5 py-1.5 border-l border-[var(--border-lt)] ${mode === 'invoices' ? 'bg-[var(--bg-muted)] font-bold' : ''}`}
              onClick={() => setMode('invoices')}
            >
              By invoice
            </button>
          </div>
          {partnerFilter && (
            <button
              type="button"
              className="text-[11px] text-[var(--navy)] font-semibold underline"
              onClick={() => setPartnerFilter(null)}
            >
              Clear filter
            </button>
          )}
        </div>
      </div>

      {mode === 'partners' ? (
        <DataTable
          tableId={`finance-ageing-partners-${kind}`}
          hideSearch
          perPage={50}
          emptyMessage="No outstanding balances"
          rowKey={r => r.id}
          rows={partnerTableRows}
          columns={[
            {
              key: 'partner',
              label: 'Partner',
              priority: 1,
              width: '1.6fr',
              render: r => r.id === '__totals__' ? (
                <span className="font-bold">{r.partnerName}</span>
              ) : (
                <button
                  type="button"
                  className="text-left font-semibold text-[var(--navy)] hover:underline"
                  onClick={() => { setPartnerFilter(r.partnerId); setMode('invoices') }}
                >
                  {r.partnerName}
                </button>
              ),
              accessor: r => r.partnerName,
            },
            {
              key: 'count',
              label: 'Docs',
              priority: 2,
              width: '70px',
              align: 'right',
              render: r => <span className="font-mono text-xs">{r.invoiceCount}</span>,
              exportValue: r => r.invoiceCount,
            },
            { key: 'current', label: 'Current', priority: 2, width: '100px', align: 'right', render: r => <span className="font-mono">{r.current ? fmtKes(r.current) : '—'}</span>, exportValue: r => r.current },
            { key: 'd30', label: '1–30', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.d30 ? fmtKes(r.d30) : '—'}</span>, exportValue: r => r.d30 },
            { key: 'd60', label: '31–60', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.d60 ? fmtKes(r.d60) : '—'}</span>, exportValue: r => r.d60 },
            { key: 'd90', label: '61–90', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.d90 ? fmtKes(r.d90) : '—'}</span>, exportValue: r => r.d90 },
            { key: 'over90', label: '90+', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.over90 ? fmtKes(r.over90) : '—'}</span>, exportValue: r => r.over90 },
            { key: 'balance', label: 'Balance', priority: 1, width: '120px', align: 'right', render: r => <span className="font-mono font-bold">{fmtKes(r.balance)}</span>, exportValue: r => r.balance },
          ]}
        />
      ) : (
        <DataTable
          tableId={`finance-ageing-invoices-${kind}`}
          hideSearch
          perPage={50}
          emptyMessage="No outstanding balances"
          rowKey={r => r.id}
          rows={invoiceTableRows}
          columns={[
            {
              key: 'ref',
              label: 'Ref',
              priority: 1,
              width: '110px',
              render: r => r.id === '__totals__' || !r.ref ? (
                <span className="font-mono text-xs">—</span>
              ) : (
                <Link href={invoiceHref(r.id)} className="font-mono text-xs font-bold text-[var(--navy)] hover:underline">
                  {r.ref}
                </Link>
              ),
              accessor: r => r.ref,
            },
            { key: 'partner', label: 'Partner', priority: 1, width: '1.4fr', render: r => <span className={r.id === '__totals__' ? 'font-bold' : ''}>{r.partnerName}</span>, accessor: r => r.partnerName },
            { key: 'due', label: 'Due date', priority: 2, width: '110px', render: r => <span className="text-xs">{r.dueDate ? fmtDate(r.dueDate) : '—'}</span>, exportValue: r => r.dueDate },
            { key: 'days', label: 'Days', priority: 2, width: '70px', align: 'right', render: r => <span className="font-mono text-xs">{r.id === '__totals__' ? '—' : r.daysPastDue}</span>, exportValue: r => r.daysPastDue },
            { key: 'current', label: 'Current', priority: 2, width: '100px', align: 'right', render: r => <span className="font-mono">{r.current ? fmtKes(r.current) : '—'}</span>, exportValue: r => r.current },
            { key: 'd30', label: '1–30', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.d30 ? fmtKes(r.d30) : '—'}</span>, exportValue: r => r.d30 },
            { key: 'd60', label: '31–60', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.d60 ? fmtKes(r.d60) : '—'}</span>, exportValue: r => r.d60 },
            { key: 'd90', label: '61–90', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.d90 ? fmtKes(r.d90) : '—'}</span>, exportValue: r => r.d90 },
            { key: 'over90', label: '90+', priority: 3, width: '90px', align: 'right', render: r => <span className="font-mono">{r.over90 ? fmtKes(r.over90) : '—'}</span>, exportValue: r => r.over90 },
            { key: 'balance', label: 'Balance', priority: 1, width: '120px', align: 'right', render: r => <span className="font-mono font-bold">{fmtKes(r.balance)}</span>, exportValue: r => r.balance },
          ]}
        />
      )}
    </div>
  )
}

export default function AgeingTab({
  customerInvoices,
  vendorBills,
}: {
  customerInvoices: Invoice[]
  vendorBills: Invoice[]
}) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1)]">Aged receivables &amp; payables</h2>
          <p className="text-xs text-[var(--text-3)]">
            Outstanding balances bucketed by Current / 1–30 / 31–60 / 61–90 / 90+ days past due.
            Click a partner to drill into invoices.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-[var(--text-3)]">
          As of
          <input
            type="date"
            className="form-input text-xs py-1.5"
            value={asOf}
            onChange={e => setAsOf(e.target.value)}
          />
        </label>
      </div>
      <AgeingReport title="Receivables ageing" kind="ar" invoices={customerInvoices} asOf={asOf} />
      <AgeingReport title="Payables ageing" kind="ap" invoices={vendorBills} asOf={asOf} />
    </div>
  )
}
