'use client'

import { useCallback, useEffect, useState } from 'react'
import { DataTable } from '@/components/data-table'
import { fmtKes } from '@/lib/store'

type Row = { code: string; name: string; amount: number; section: string }

type CashFlowResponse = {
  dateFrom: string
  dateTo: string
  operating: Array<{ code: string; name: string; amount: number }>
  investing: Array<{ code: string; name: string; amount: number }>
  financing: Array<{ code: string; name: string; amount: number }>
  totalOperating: number
  totalInvesting: number
  totalFinancing: number
  netChange: number
  openingCash: number
  closingCash: number
}

export default function CashFlowPanel() {
  const year = new Date().getFullYear()
  const [dateFrom, setDateFrom] = useState(`${year}-01-01`)
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState<CashFlowResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/accounting/cash-flow?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load cash flow')
      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cash flow')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { void refresh() }, [refresh])

  const rows: Row[] = report
    ? [
        ...report.operating.map(r => ({ ...r, section: 'Operating' })),
        { code: '', name: 'Net cash from operations', amount: report.totalOperating, section: 'Operating' },
        ...report.investing.map(r => ({ ...r, section: 'Investing' })),
        { code: '', name: 'Net cash from investing', amount: report.totalInvesting, section: 'Investing' },
        ...report.financing.map(r => ({ ...r, section: 'Financing' })),
        { code: '', name: 'Net cash from financing', amount: report.totalFinancing, section: 'Financing' },
        { code: '', name: 'Opening cash', amount: report.openingCash, section: 'Total' },
        { code: '', name: 'Net change in cash', amount: report.netChange, section: 'Total' },
        { code: '', name: 'Closing cash', amount: report.closingCash, section: 'Total' },
      ]
    : []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1)]">Cash flow statement</h2>
          <p className="text-xs text-[var(--text-3)]">Direct-method cash movements from posted cash GL lines.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className="form-input text-[11px] py-1.5" value={dateFrom} onChange={e => setDateFrom(e.target.value)} aria-label="Cash flow from" />
          <input type="date" className="form-input text-[11px] py-1.5" value={dateTo} onChange={e => setDateTo(e.target.value)} aria-label="Cash flow to" />
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">{error}</div>}
      <DataTable
        tableId="finance-cash-flow"
        hideSearch
        perPage={80}
        emptyMessage={loading ? 'Loading…' : 'No cash movements in this period'}
        rowKey={r => `${r.section}-${r.code}-${r.name}-${r.amount}`}
        rows={rows}
        columns={[
          { key: 'section', label: 'Section', priority: 2, width: '120px', render: r => r.section, accessor: r => r.section },
          { key: 'name', label: 'Line', priority: 1, width: '2fr', render: r => <span className={!r.code ? 'font-bold' : ''}>{r.name}</span>, accessor: r => r.name },
          { key: 'amount', label: 'Amount', priority: 1, width: '140px', align: 'right', render: r => <span className={`font-mono ${!r.code ? 'font-bold' : ''}`}>{fmtKes(r.amount)}</span>, exportValue: r => r.amount },
        ]}
        exportTitle="Cash flow statement"
        exportFilename="cash-flow"
      />
    </div>
  )
}
