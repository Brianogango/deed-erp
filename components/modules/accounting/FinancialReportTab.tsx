'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { exportToExcel } from '@/lib/export-utils'
import { Fa } from '@/components/icons'
import { faDownload, faPrint, faScaleBalanced, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'

type Preset = 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom'

type Report = {
  period: { dateFrom: string; dateTo: string }
  generatedAt: string
  profitLoss: {
    totalRevenue: number
    totalOtherIncome: number
    totalIncome: number
    totalCogs: number
    grossProfit: number
    totalOperating: number
    totalFinance: number
    totalExpenses: number
    netProfit: number
    revenue: Array<{ code: string; name: string; amount: number }>
    otherIncome: Array<{ code: string; name: string; amount: number }>
    cogs: Array<{ code: string; name: string; amount: number }>
    operatingExpenses: Array<{ code: string; name: string; amount: number }>
    financeCosts: Array<{ code: string; name: string; amount: number }>
  }
  balanceSheet: {
    asOf: string
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    balanced: boolean
    assets: Array<{ code: string; name: string; amount: number }>
    liabilities: Array<{ code: string; name: string; amount: number }>
    equity: Array<{ code: string; name: string; amount: number }>
  }
  cashFlow: {
    openingCash: number
    closingCash: number
    totalOperating: number
    totalInvesting: number
    totalFinancing: number
  }
  trialBalance: { asOf: string; balanced: boolean; totalDebit: number; totalCredit: number }
  daily: Array<{ date: string; revenue: number; expenses: number; net: number }>
}

const fmtKes = (n: number) =>
  `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const todayIso = () => new Date().toISOString().slice(0, 10)
const weekStartIso = () => {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // Monday
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

function presetRange(preset: Preset, customFrom: string, customTo: string): { dateFrom: string; dateTo: string } {
  const today = todayIso()
  switch (preset) {
    case 'today': return { dateFrom: today, dateTo: today }
    case 'this_week': return { dateFrom: weekStartIso(), dateTo: today }
    case 'this_month': return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }
    case 'this_year': return { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today }
    case 'custom': return { dateFrom: customFrom || today, dateTo: customTo || today }
  }
}

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'this_year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
]

export default function FinancialReportTab() {
  const [preset, setPreset] = useState<Preset>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/accounting/financial-report?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setReport(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the report')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [range.dateFrom, range.dateTo])

  useEffect(() => { void load() }, [load])

  const exportExcel = useCallback(async () => {
    if (!report) return
    const pl = report.profitLoss
    const rows: Array<Array<string | number>> = [
      ['FINANCIAL REPORT', `${report.period.dateFrom} → ${report.period.dateTo}`],
      [],
      ['KEY FIGURES', ''],
      ['Total revenue', pl.totalRevenue],
      ['Other income', pl.totalOtherIncome],
      ['Total income', pl.totalIncome],
      ['Cost of goods sold', pl.totalCogs],
      ['Gross profit', pl.grossProfit],
      ['Operating expenses', pl.totalOperating],
      ['Finance costs', pl.totalFinance],
      ['Net profit', pl.netProfit],
      [],
      ['BALANCE SHEET (as at ' + report.balanceSheet.asOf + ')', ''],
      ['Total assets', report.balanceSheet.totalAssets],
      ['Total liabilities', report.balanceSheet.totalLiabilities],
      ['Total equity', report.balanceSheet.totalEquity],
      ['Balanced', report.balanceSheet.balanced ? 'Yes' : 'No'],
      [],
      ['CASH FLOW', ''],
      ['Opening cash', report.cashFlow.openingCash],
      ['Operating activities', report.cashFlow.totalOperating],
      ['Investing activities', report.cashFlow.totalInvesting],
      ['Financing activities', report.cashFlow.totalFinancing],
      ['Closing cash', report.cashFlow.closingCash],
      [],
      ['DAILY BREAKDOWN', '', ''],
      ['Date', 'Revenue', 'Expenses', 'Net'],
      ...report.daily.map(d => [d.date, d.revenue, d.expenses, d.net]),
      [],
      ['REVENUE BY ACCOUNT', ''],
      ...pl.revenue.map(r => [`${r.code} ${r.name}`, r.amount]),
      [],
      ['EXPENSES BY ACCOUNT', ''],
      ...[...pl.cogs, ...pl.operatingExpenses, ...pl.financeCosts].map(r => [`${r.code} ${r.name}`, r.amount]),
    ]
    await exportToExcel(
      `Financial Report — ${report.period.dateFrom} to ${report.period.dateTo}`,
      ['Item', 'Amount (KES)'],
      rows.map(r => r.map(c => c ?? '')),
      `Financial_Report_${report.period.dateFrom}_${report.period.dateTo}`,
    )
  }, [report])

  const pl = report?.profitLoss
  const bs = report?.balanceSheet
  const cf = report?.cashFlow

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1)]">Financial Report</h2>
          <p className="text-xs text-[var(--text-3)] mt-1">
            Source of truth — every figure derives from posted GL journals. P&L, balance sheet, cash flow, and the daily breakdown for the period.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)] p-1">
            {PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${preset === p.id ? 'bg-[var(--navy)] text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-surface-2)]'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="form-input text-[11px]" />
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="form-input text-[11px]" />
            </>
          )}
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void exportExcel()} disabled={!report}>
            <Fa icon={faDownload} /> Export
          </button>
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => window.print()} disabled={!report}>
            <Fa icon={faPrint} /> Print
          </button>
        </div>
      </div>

      {loading && <div className="card p-8 text-center text-xs text-[var(--text-4)]">Building the report from posted journals…</div>}
      {error && <div className="card p-4 text-xs text-[var(--danger)]">{error}</div>}

      {report && pl && bs && cf && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total income', value: pl.totalIncome, tone: 'text-[var(--text-1)]' },
              { label: 'Gross profit', value: pl.grossProfit, tone: pl.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600' },
              { label: 'Net profit', value: pl.netProfit, tone: pl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600' },
              { label: 'Cash movement', value: cf.closingCash - cf.openingCash, tone: (cf.closingCash - cf.openingCash) >= 0 ? 'text-emerald-600' : 'text-red-600' },
            ].map(k => (
              <div key={k.label} className="card p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)]">{k.label}</p>
                <p className={`text-xl font-black font-mono mt-1 ${k.tone}`}>{fmtKes(k.value)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Profit &amp; Loss</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span>Revenue</span><span className="font-mono font-bold">{fmtKes(pl.totalRevenue)}</span></div>
                {pl.totalOtherIncome !== 0 && <div className="flex justify-between"><span>Other income</span><span className="font-mono font-bold">{fmtKes(pl.totalOtherIncome)}</span></div>}
                <div className="flex justify-between text-[var(--text-3)]"><span>Cost of goods sold</span><span className="font-mono">({fmtKes(pl.totalCogs)})</span></div>
                <div className="flex justify-between border-t border-[var(--border-lt)] pt-1.5 font-bold"><span>Gross profit</span><span className="font-mono">{fmtKes(pl.grossProfit)}</span></div>
                <div className="flex justify-between text-[var(--text-3)]"><span>Operating expenses</span><span className="font-mono">({fmtKes(pl.totalOperating)})</span></div>
                {pl.totalFinance !== 0 && <div className="flex justify-between text-[var(--text-3)]"><span>Finance costs</span><span className="font-mono">({fmtKes(pl.totalFinance)})</span></div>}
                <div className="flex justify-between border-t border-[var(--border-lt)] pt-1.5 font-black"><span>Net profit</span><span className={`font-mono ${pl.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtKes(pl.netProfit)}</span></div>
              </div>
            </div>

            <div className="card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Balance Sheet · as at {bs.asOf}</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span>Total assets</span><span className="font-mono font-bold">{fmtKes(bs.totalAssets)}</span></div>
                <div className="flex justify-between"><span>Total liabilities</span><span className="font-mono font-bold">({fmtKes(bs.totalLiabilities)})</span></div>
                <div className="flex justify-between"><span>Total equity</span><span className="font-mono font-bold">({fmtKes(bs.totalEquity)})</span></div>
                <div className="flex justify-between border-t border-[var(--border-lt)] pt-1.5 font-bold items-center">
                  <span>Balance check</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${bs.balanced ? 'text-emerald-600' : 'text-amber-600'}`}>
                    <Fa icon={bs.balanced ? faScaleBalanced : faTriangleExclamation} />
                    {bs.balanced ? 'Balanced' : 'Out of balance'}
                  </span>
                </div>
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mt-4 mb-3">Cash Flow</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span>Opening cash</span><span className="font-mono">{fmtKes(cf.openingCash)}</span></div>
                <div className="flex justify-between"><span>Operating</span><span className="font-mono">{fmtKes(cf.totalOperating)}</span></div>
                {cf.totalInvesting !== 0 && <div className="flex justify-between"><span>Investing</span><span className="font-mono">{fmtKes(cf.totalInvesting)}</span></div>}
                {cf.totalFinancing !== 0 && <div className="flex justify-between"><span>Financing</span><span className="font-mono">{fmtKes(cf.totalFinancing)}</span></div>}
                <div className="flex justify-between border-t border-[var(--border-lt)] pt-1.5 font-bold"><span>Closing cash</span><span className="font-mono">{fmtKes(cf.closingCash)}</span></div>
              </div>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Daily breakdown</p>
            {report.daily.length === 0 ? (
              <p className="text-xs text-[var(--text-4)]">No posted activity in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--text-4)] border-b border-[var(--border-lt)]">
                      <th className="py-1.5 pr-4 font-semibold">Date</th>
                      <th className="py-1.5 pr-4 font-semibold text-right">Revenue</th>
                      <th className="py-1.5 pr-4 font-semibold text-right">Expenses</th>
                      <th className="py-1.5 font-semibold text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.daily.map(d => (
                      <tr key={d.date} className="border-b border-[var(--border-lt)] last:border-0">
                        <td className="py-1.5 pr-4">{d.date}</td>
                        <td className="py-1.5 pr-4 text-right font-mono">{fmtKes(d.revenue)}</td>
                        <td className="py-1.5 pr-4 text-right font-mono text-red-600">({fmtKes(d.expenses)})</td>
                        <td className={`py-1.5 text-right font-mono font-bold ${d.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtKes(d.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Revenue by account</p>
              <div className="space-y-1.5 text-xs">
                {pl.revenue.length === 0 && <p className="text-[var(--text-4)]">No revenue posted in this period.</p>}
                {pl.revenue.map(r => (
                  <div key={r.code} className="flex justify-between"><span>{r.code} · {r.name}</span><span className="font-mono font-bold">{fmtKes(r.amount)}</span></div>
                ))}
                {pl.otherIncome.map(r => (
                  <div key={r.code} className="flex justify-between"><span>{r.code} · {r.name}</span><span className="font-mono font-bold">{fmtKes(r.amount)}</span></div>
                ))}
              </div>
            </div>
            <div className="card p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-4)] mb-3">Expenses by account</p>
              <div className="space-y-1.5 text-xs">
                {[...pl.cogs, ...pl.operatingExpenses, ...pl.financeCosts].length === 0 && <p className="text-[var(--text-4)]">No expenses posted in this period.</p>}
                {[...pl.cogs, ...pl.operatingExpenses, ...pl.financeCosts].map(r => (
                  <div key={r.code} className="flex justify-between"><span>{r.code} · {r.name}</span><span className="font-mono font-bold">{fmtKes(r.amount)}</span></div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[10px] text-[var(--text-4)]">
            Generated {new Date(report.generatedAt).toLocaleString('en-KE')} · Trial balance {report.trialBalance.balanced ? 'balanced' : 'OUT OF BALANCE'} as at {report.trialBalance.asOf} · Source: posted GL journals (Prisma).
          </p>
        </>
      )}
    </div>
  )
}
