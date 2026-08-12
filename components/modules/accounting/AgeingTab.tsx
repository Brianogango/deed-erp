'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DataTable } from '@/components/data-table'
import { fmtDate, fmtKes, type Invoice } from '@/lib/store'
import { bucketOpenInvoices, type AgeingReport as AgeingReportData, type AgeingRow } from '@/lib/accounting/ageing'

type ViewMode = 'invoices' | 'partners'

function AgeingReport({
  title,
  kind,
  invoices,
  asOf,
  prismaReport,
}: {
  title: string
  kind: 'ar' | 'ap'
  invoices: Invoice[]
  asOf: string
  prismaReport: AgeingReportData | null
}) {
  const [mode, setMode] = useState<ViewMode>('partners')
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null)

  const blobReport = useMemo(
    () => bucketOpenInvoices(invoices, asOf || new Date().toISOString().slice(0, 10)),
    [invoices, asOf],
  )
  const report = prismaReport || blobReport

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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-[var(--text-1)]">
          {title}
          <span className="ml-2 text-[10px] font-semibold text-[var(--text-3)]">
            {prismaReport ? 'Prisma' : 'Blob fallback'}
          </span>
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className={`text-[11px] px-2 py-1 rounded ${mode === 'partners' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg-2)]'}`}
            onClick={() => { setMode('partners'); setPartnerFilter(null) }}
          >
            Partners
          </button>
          <button
            type="button"
            className={`text-[11px] px-2 py-1 rounded ${mode === 'invoices' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg-2)]'}`}
            onClick={() => setMode('invoices')}
          >
            Invoices
          </button>
        </div>
      </div>

      {mode === 'partners' ? (
        <DataTable
          tableId={`ageing-partners-${kind}`}
          hideSearch
          perPage={50}
          rowKey={row => row.id}
          rows={partnerTableRows}
          onRowClick={row => {
            if (row.id === '__totals__') return
            setPartnerFilter(row.partnerId || row.partnerName)
            setMode('invoices')
          }}
          columns={[
            { key: 'partner', label: 'Partner', priority: 1, width: '2fr', render: r => <span className={r.id === '__totals__' ? 'font-bold' : ''}>{r.partnerName}</span>, accessor: r => r.partnerName },
            { key: 'count', label: 'Docs', priority: 2, width: '70px', align: 'right', render: r => <span className="font-mono text-xs">{r.invoiceCount}</span>, exportValue: r => r.invoiceCount },
            { key: 'current', label: 'Current', priority: 2, width: '100px', align: 'right', render: r => <span className="font-mono text-xs">{fmtKes(r.current)}</span>, exportValue: r => r.current },
            { key: 'd30', label: '1–30', priority: 2, width: '90px', align: 'right', render: r => <span className="font-mono text-xs">{fmtKes(r.d30)}</span>, exportValue: r => r.d30 },
            { key: 'd60', label: '31–60', priority: 2, width: '90px', align: 'right', render: r => <span className="font-mono text-xs">{fmtKes(r.d60)}</span>, exportValue: r => r.d60 },
            { key: 'd90', label: '61–90', priority: 2, width: '90px', align: 'right', render: r => <span className="font-mono text-xs">{fmtKes(r.d90)}</span>, exportValue: r => r.d90 },
            { key: 'over90', label: '90+', priority: 1, width: '90px', align: 'right', render: r => <span className="font-mono text-xs">{fmtKes(r.over90)}</span>, exportValue: r => r.over90 },
            { key: 'balance', label: 'Total', priority: 1, width: '110px', align: 'right', render: r => <span className={`font-mono text-xs ${r.id === '__totals__' ? 'font-bold' : ''}`}>{fmtKes(r.balance)}</span>, exportValue: r => r.balance },
          ]}
        />
      ) : (
        <DataTable
          tableId={`ageing-invoices-${kind}`}
          hideSearch
          perPage={50}
          rowKey={row => row.id}
          rows={invoiceTableRows}
          columns={[
            {
              key: 'ref', label: 'Ref', priority: 1, width: '110px',
              render: r => r.id === '__totals__' ? <span className="font-bold">Totals</span> : (
                <Link href={invoiceHref(r.id)} className="font-mono text-xs text-primary-600">{r.ref}</Link>
              ),
              exportValue: r => r.ref,
            },
            { key: 'partner', label: 'Partner', priority: 1, width: '1.4fr', render: r => <span>{r.partnerName}</span>, accessor: r => r.partnerName },
            { key: 'due', label: 'Due', priority: 2, width: '100px', render: r => <span className="text-xs text-[var(--text-3)]">{r.dueDate ? fmtDate(r.dueDate) : '—'}</span>, exportValue: r => r.dueDate || '' },
            { key: 'days', label: 'Days', priority: 2, width: '70px', align: 'right', render: r => <span className="font-mono text-xs">{r.id === '__totals__' ? '—' : r.daysPastDue}</span>, exportValue: r => r.daysPastDue },
            { key: 'balance', label: 'Balance', priority: 1, width: '110px', align: 'right', render: r => <span className={`font-mono text-xs ${r.id === '__totals__' ? 'font-bold' : ''}`}>{fmtKes(r.balance)}</span>, exportValue: r => r.balance },
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
  const [arPrisma, setArPrisma] = useState<AgeingReportData | null>(null)
  const [apPrisma, setApPrisma] = useState<AgeingReportData | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (kind: 'ar' | 'ap') => {
      try {
        const res = await fetch(`/api/accounting/ageing?kind=${kind}&asOf=${asOf}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) return null
        return {
          rows: data.rows || [],
          totals: data.totals,
          partners: data.partners || [],
        } as AgeingReportData
      } catch {
        return null
      }
    }
    void Promise.all([load('ar'), load('ap')]).then(([ar, ap]) => {
      if (cancelled) return
      setArPrisma(ar)
      setApPrisma(ap)
    })
    return () => { cancelled = true }
  }, [asOf])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1)]">Aged receivables &amp; payables</h2>
          <p className="text-xs text-[var(--text-3)]">
            Outstanding balances from Prisma invoices (blob fallback). Buckets: Current / 1–30 / 31–60 / 61–90 / 90+.
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
      <AgeingReport title="Receivables ageing" kind="ar" invoices={customerInvoices} asOf={asOf} prismaReport={arPrisma} />
      <AgeingReport title="Payables ageing" kind="ap" invoices={vendorBills} asOf={asOf} prismaReport={apPrisma} />
    </div>
  )
}
