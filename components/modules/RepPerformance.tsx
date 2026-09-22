'use client'
import { Suspense, useMemo, useState, useEffect } from 'react'
import { useSalesStore, fmtKes, fmtDate } from '@/lib/store'
import { ModuleSkeleton } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { visibleDashboardRepUsers, visibleDashboardSalesOrders } from '@/lib/dashboard-priority'
import { useUrlRecordId } from '@/hooks/useUrlRecordId'
import { periodMonthsFromKey } from '@/lib/accounting/sales-commission-view'
import {
  attributedSales,
  isRepCandidateRole,
  salesForCloser,
  salesVisibleToViewer,
  summarizeCloserSales,
  type AttributedSale,
} from '@/lib/sales/rep-sales'
import Link from 'next/link'

// ── Helpers ───────────────────────────────────────────────────────────────────

function periodBounds(key: string): { start: string; end: string } {
  if (key.includes('-Q')) {
    const [yr, q] = key.split('-Q')
    const qn = Number(q)
    const startMonth = (qn - 1) * 3 + 1
    const endMonth = startMonth + 2
    const endDay = new Date(Number(yr), endMonth, 0).getDate()
    return {
      start: `${yr}-${String(startMonth).padStart(2, '0')}-01`,
      end:   `${yr}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
    }
  }
  const [yr, mo] = key.split('-')
  const lastDay = new Date(Number(yr), Number(mo), 0).getDate()
  return {
    start: `${yr}-${mo}-01`,
    end:   `${yr}-${mo}-${String(lastDay).padStart(2, '0')}`,
  }
}

function lastNMonths(n: number): string[] {
  const keys: string[] = []
  const d = new Date()
  for (let i = 0; i < n; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1)
    keys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys.reverse()
}

function fmtPeriodLabel(key: string): string {
  if (!key) return 'No period selected'
  if (key.includes('-Q')) {
    const [yr, q] = key.split('-Q')
    return `Q${q} ${yr}`
  }
  const [yr, mo] = key.split('-')
  return new Date(Number(yr), Number(mo) - 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface RepStats {
  userId: string
  name: string
  role: string
  ordersCount: number
  quotesCount: number
  revenue: number
  conversionRate: number   // confirmed+/all quotes %
  avgOrderValue: number
  commission: number
  targetRevenue: number    // from active SOP if exists
  targetOrders: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RepPerformance() {
  return (
    <Suspense fallback={<ModuleSkeleton />}>
      <RepPerformanceContent />
    </Suspense>
  )
}

function RepPerformanceContent() {
  const { saleOrders, posOrders, users, currentUserId, sops } = useSalesStore()

  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const [periodMode, setPeriodMode] = useState<'month' | 'quarter'>('month')
  // Period starts empty — the user picks which month/quarter to report on.
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [selectedRep, setSelectedRep] = useUrlRecordId({ param: 'rep' })
  const [ledgerByEmployee, setLedgerByEmployee] = useState<Record<string, number>>({})

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const visibleOrders = useMemo(
    () => visibleDashboardSalesOrders(currentUser, saleOrders),
    [currentUser, saleOrders],
  )
  const visibleTickets = useMemo(
    () => salesVisibleToViewer(currentUser, posOrders ?? []),
    [currentUser, posOrders],
  )
  const allAttributed = useMemo(
    () => attributedSales({ saleOrders: visibleOrders, posOrders: visibleTickets }),
    [visibleOrders, visibleTickets],
  )

  // Period options
  const periodOptions = useMemo(() => {
    if (periodMode === 'month') return lastNMonths(6)
    const d = new Date()
    return Array.from({ length: 4 }, (_, i) => {
      const dt = new Date(d.getFullYear(), d.getMonth() - i * 3, 1)
      const q = Math.ceil((dt.getMonth() + 1) / 3)
      return `${dt.getFullYear()}-Q${q}`
    }).reverse()
  }, [periodMode])

  // Active period key
  const periodKey = periodOptions.includes(selectedPeriod) ? selectedPeriod : ''
  const { start, end } = periodKey ? periodBounds(periodKey) : { start: '', end: '' }
  const inPeriod = (d?: string) => !!periodKey && !!d && d >= start && d <= end

  useEffect(() => {
    let cancelled = false
    const months = periodMonthsFromKey(periodKey)
    if (months.length === 0) {
      setLedgerByEmployee({})
      return
    }
    Promise.all(
      months.map(({ year, month }) =>
        fetch(`/api/sales-commissions?summary=1&periodYear=${year}&periodMonth=${month}`).then(r =>
          r.ok ? r.json() : { summary: { byEmployee: [] } },
        ),
      ),
    )
      .then(payloads => {
        if (cancelled) return
        const totals: Record<string, number> = {}
        for (const payload of payloads) {
          for (const row of payload.summary?.byEmployee ?? []) {
            totals[row.employeeId] = (totals[row.employeeId] ?? 0) + Number(row.commissionAmount ?? 0)
          }
        }
        setLedgerByEmployee(totals)
      })
      .catch(() => {
        if (!cancelled) setLedgerByEmployee({})
      })
    return () => {
      cancelled = true
    }
  }, [periodKey])

  const periodSales = useMemo(
    () => allAttributed.filter(sale => inPeriod(sale.date)),
    [allAttributed, start, end],
  )

  // Closers on till/SO plus commission-eligible logins
  const repUsers = useMemo(() => {
    const closerIds = new Set(periodSales.map(sale => sale.closerId))
    const candidates = users.filter(u =>
      isRepCandidateRole(u.role) || closerIds.has(u.id)
    )
    return visibleDashboardRepUsers(currentUser, candidates)
  }, [users, periodSales, currentUser])

  const repStats: RepStats[] = useMemo(() => {
    return repUsers.map(u => {
      const closed = salesForCloser(periodSales, u.id)
      const quotes = visibleOrders.filter(o => (o.salespersonId || o.createdByUserId) === u.id && inPeriod(o.date)).length
      const { salesCount, saleAmount } = summarizeCloserSales(closed)
      const conv = quotes === 0 ? 0 : Math.round((salesCount / quotes) * 100)
      const avg = salesCount === 0 ? 0 : Math.round(saleAmount / salesCount)
      const empId = u.employeeId
      const commission = empId ? ledgerByEmployee[empId] ?? 0 : 0
      const sop = sops.find(s => s.userId === u.id && s.active)
      const targetRevenue = sop?.metrics.find(m => m.metricType === 'sales_revenue')?.target ?? 0
      const targetOrders  = sop?.metrics.find(m => m.metricType === 'sales_orders')?.target ?? 0

      return {
        userId: u.id,
        name: u.name,
        role: u.role ?? '',
        ordersCount: salesCount,
        quotesCount: quotes,
        revenue: saleAmount,
        conversionRate: conv,
        avgOrderValue: avg,
        commission,
        targetRevenue,
        targetOrders,
      }
    }).sort((a, b) => b.revenue - a.revenue)
  }, [repUsers, periodSales, visibleOrders, sops, ledgerByEmployee, start, end])

  const repTrend = useMemo(() => {
    if (!selectedRep) return []
    return lastNMonths(6).map(mk => {
      const { start: s, end: e } = periodBounds(mk)
      const orders = salesForCloser(allAttributed, selectedRep, s, e)
      return { month: mk, revenue: summarizeCloserSales(orders).saleAmount, count: orders.length }
    })
  }, [selectedRep, allAttributed])

  const detail = selectedRep ? repStats.find(r => r.userId === selectedRep) : null

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function pctBar(actual: number, target: number) {
    if (!target) return null
    const p = Math.min(100, Math.round((actual / target) * 100))
    const color = p >= 100 ? 'var(--success)' : p >= 70 ? 'var(--warning)' : 'var(--danger)'
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-4)', marginBottom: 2 }}>
          <span>{p}% of target</span>
          <span>Target: {target >= 1000 ? fmtKes(target) : target}</span>
        </div>
        <div style={{ height: 4, background: 'var(--border-lt)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────────
  if (detail) {
    const maxRev = Math.max(...repTrend.map(t => t.revenue), 1)
    const repOrders = salesForCloser(periodSales, selectedRep)
      .sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref))
      .slice(0, 20)

    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => setSelectedRep(null)}
          style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--accent-cyan)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Back to all reps
        </button>

        {/* Rep header */}
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 16,
            }}>
              {detail.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{detail.name}</p>
              <p style={{ fontSize: 11, color: 'var(--text-4)' }}>{detail.role.replace(/_/g, ' ')} · {fmtPeriodLabel(periodKey)}</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {[
              { label: 'Sales total', value: fmtKes(detail.revenue) },
              { label: 'Sales', value: detail.ordersCount },
              { label: 'Quotes', value: detail.quotesCount },
              { label: 'Conversion', value: `${detail.conversionRate}%` },
              { label: 'Commission', value: fmtKes(detail.commission), highlight: true },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: kpi.highlight ? 'var(--warning-bg)' : 'var(--bg-surface)', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{kpi.label}</p>
                <p style={{ fontSize: 16, fontWeight: 700, color: kpi.highlight ? 'var(--warning-text)' : 'var(--text-1)' }}>{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Targets progress */}
          {(detail.targetRevenue > 0 || detail.targetOrders > 0) && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {detail.targetRevenue > 0 && (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Revenue Target</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{fmtKes(detail.revenue)}</p>
                  {pctBar(detail.revenue, detail.targetRevenue)}
                </div>
              )}
              {detail.targetOrders > 0 && (
                <div style={{ background: 'var(--bg-surface)', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Orders Target</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{detail.ordersCount} orders</p>
                  {pctBar(detail.ordersCount, detail.targetOrders)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Commission earned on posted invoices */}
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12 }}>Sales and commission</p>
          <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--bg-muted)', paddingBottom: 4, marginBottom: 4 }}>
              <span>POS + confirmed sale orders this period</span>
              <span style={{ fontWeight: 600 }}>{fmtKes(detail.revenue)}</span>
            </div>
            <p style={{ margin: '8px 0', lineHeight: 1.5 }}>
              Sales total includes every till ticket and confirmed sale order closed by this person, even when commission is zero. Commission posts only when the invoice has a product or category rate.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-lt)', paddingTop: 8, marginTop: 4, fontWeight: 700, color: 'var(--warning-text)', fontSize: 13 }}>
              <span>Ledger commission</span>
              <span>{fmtKes(detail.commission)}</span>
            </div>
            <Link href="/finance?tab=commissions" className="mt-2 inline-block text-[11px] underline underline-offset-2">
              Open Finance → Commissions
            </Link>
          </div>
        </div>

        {/* Revenue trend chart */}
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 16 }}>Revenue Trend (Last 6 Months)</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
            {repTrend.map(t => {
              const h = Math.max(4, Math.round((t.revenue / maxRev) * 72))
              return (
                <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 8, color: 'var(--text-4)' }}>{t.revenue > 0 ? fmtKes(t.revenue) : ''}</span>
                  <div style={{ width: '100%', height: h, background: t.month === periodKey ? 'var(--navy)' : 'var(--accent-cyan)', borderRadius: '4px 4px 0 0', opacity: 0.85 }} title={`${fmtKes(t.revenue)}, ${t.count} orders`} />
                  <span style={{ fontSize: 9, color: 'var(--text-4)' }}>{t.month.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent orders */}
        <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 20, overflow: 'hidden' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12 }}>Sales this period</p>
          <DataTable
            tableId="rep-performance-orders"
            columns={[
              { key: 'ref', label: 'Ref', priority: 1, width: '110px', render: (o: AttributedSale) => <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{o.ref}</span>, exportValue: (o: AttributedSale) => o.ref },
              { key: 'source', label: 'Source', priority: 2, width: '90px', render: (o: AttributedSale) => <span style={{ color: 'var(--text-3)' }}>{o.source === 'pos' ? 'POS' : 'Sale order'}</span>, exportValue: (o: AttributedSale) => o.source },
              { key: 'customer', label: 'Customer', priority: 1, width: '1.4fr', render: (o: AttributedSale) => <span style={{ color: 'var(--text-3)' }}>{o.customerName}</span>, exportValue: (o: AttributedSale) => o.customerName },
              { key: 'date', label: 'Date', priority: 2, width: '100px', render: (o: AttributedSale) => <span style={{ color: 'var(--text-4)' }}>{fmtDate(o.date)}</span>, exportValue: (o: AttributedSale) => o.date },
              { key: 'total', label: 'Total', priority: 1, width: '110px', align: 'right', render: (o: AttributedSale) => <span style={{ fontWeight: 600 }}>{fmtKes(o.total)}</span>, exportValue: (o: AttributedSale) => o.total },
            ] as ColumnDef<AttributedSale>[]}
            rows={repOrders}
            rowKey={o => o.id}
            hideSearch
            emptyMessage="No sales linked to this person in this period."
            perPage={10}
            exportTitle="Rep Sales"
            exportFilename="rep-sales"
          />
        </div>
      </div>
    )
  }

  // ── Overview: leaderboard ─────────────────────────────────────────────────────
  const totalRevenue = repStats.reduce((s, r) => s + r.revenue, 0)
  const maxRevenue   = Math.max(...repStats.map(r => r.revenue), 1)

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="flex flex-col gap-4">

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ display: 'flex', background: 'var(--bg-muted)', borderRadius: 8, padding: 2, gap: 2 }}>
          {(['month', 'quarter'] as const).map(m => (
            <button key={m} onClick={() => {
              setPeriodMode(m)
              setSelectedPeriod('')
            }} style={{
              fontSize: 11, fontWeight: periodMode === m ? 700 : 400, padding: '4px 12px',
              borderRadius: 6, border: 'none', cursor: 'pointer',
              background: periodMode === m ? '#fff' : 'transparent',
              color: periodMode === m ? 'var(--navy)' : 'var(--text-4)',
              boxShadow: periodMode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}>
              {m === 'month' ? 'Monthly' : 'Quarterly'}
            </button>
          ))}
        </div>
        <select
          aria-label="Performance period"
          value={periodKey}
          onChange={e => setSelectedPeriod(e.target.value)}
          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', color: 'var(--text-3)', background: '#fff' }}>
          <option value="" disabled>Select period…</option>
          {periodOptions.map(k => (
            <option key={k} value={k}>{fmtPeriodLabel(k)}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 4 }}>
          Team Total: <strong style={{ color: 'var(--navy)' }}>{fmtKes(totalRevenue)}</strong>
        </span>
      </div>

      {!periodKey ? (
        <div role="status" style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Select a period</p>
          <p style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>Choose a month or quarter above to see sales by closer and commissions.</p>
        </div>
      ) : (<>
      {/* Leaderboard table */}
      <div style={{ background: '#fff', border: '1px solid var(--border-lt)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--bg-muted)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Sales by closer — {fmtPeriodLabel(periodKey)}</p>
        </div>
        <DataTable
          tableId="rep-performance-leaderboard"
          columns={[
            {
              key: 'rank', label: '#', priority: 1, width: '50px', align: 'center',
              render: (r: RepStats) => {
                const idx = repStats.findIndex(x => x.userId === r.userId)
                return <span style={{ color: idx === 0 ? 'var(--warning)' : 'var(--text-4)', fontWeight: 700 }}>{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}</span>
              },
              exportValue: (r: RepStats) => repStats.findIndex(x => x.userId === r.userId) + 1,
            },
            {
              key: 'rep', label: 'Rep', priority: 1, width: '1.4fr',
              render: (r: RepStats) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--navy), var(--accent-cyan))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 10, flexShrink: 0,
                  }}>
                    {r.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, color: 'var(--text-1)' }}>{r.name}</p>
                    <p style={{ fontSize: 9, color: 'var(--text-4)' }}>{r.role.replace(/_/g, ' ')}</p>
                  </div>
                </div>
              ),
              accessor: (r: RepStats) => r.name,
              exportValue: (r: RepStats) => r.name,
            },
            { key: 'quotes', label: 'Quotes', priority: 2, width: '70px', align: 'center', render: (r: RepStats) => <span style={{ color: 'var(--text-3)' }}>{r.quotesCount}</span>, exportValue: (r: RepStats) => r.quotesCount },
            { key: 'closed', label: 'Sales', priority: 1, width: '70px', align: 'center', render: (r: RepStats) => <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.ordersCount}</span>, exportValue: (r: RepStats) => r.ordersCount },
            {
              key: 'conv', label: 'Conv.', priority: 2, width: '70px', align: 'center',
              render: (r: RepStats) => (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                  background: r.conversionRate >= 70 ? 'var(--success-bg)' : r.conversionRate >= 40 ? '#FEF9C3' : 'var(--danger-bg)',
                  color: r.conversionRate >= 70 ? 'var(--success-text)' : r.conversionRate >= 40 ? '#854D0E' : '#991B1B',
                }}>{r.conversionRate}%</span>
              ),
              exportValue: (r: RepStats) => r.conversionRate,
            },
            {
              key: 'revenue', label: 'Revenue', priority: 1, width: '120px',
              render: (r: RepStats) => {
                const share = Math.round((r.revenue / maxRevenue) * 100)
                return (
                  <div>
                    <p style={{ fontWeight: 700, color: 'var(--text-1)' }}>{fmtKes(r.revenue)}</p>
                    <div style={{ height: 3, background: 'var(--border-lt)', borderRadius: 2, marginTop: 3, width: '80%' }}>
                      <div style={{ height: '100%', width: `${share}%`, background: 'var(--accent-cyan)', borderRadius: 2 }} />
                    </div>
                  </div>
                )
              },
              exportValue: (r: RepStats) => r.revenue,
            },
            { key: 'avg', label: 'Avg order', priority: 3, width: '100px', render: (r: RepStats) => <span style={{ color: 'var(--text-3)' }}>{r.avgOrderValue > 0 ? fmtKes(r.avgOrderValue) : '—'}</span>, exportValue: (r: RepStats) => r.avgOrderValue },
            {
              key: 'target', label: 'Vs target', priority: 2, width: '90px',
              render: (r: RepStats) => {
                const targetPct = r.targetRevenue > 0 ? Math.min(150, Math.round((r.revenue / r.targetRevenue) * 100)) : null
                return targetPct !== null ? (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                    background: targetPct >= 100 ? 'var(--success-bg)' : targetPct >= 70 ? '#FEF9C3' : 'var(--danger-bg)',
                    color: targetPct >= 100 ? 'var(--success-text)' : targetPct >= 70 ? '#854D0E' : '#991B1B',
                  }}>{targetPct}%</span>
                ) : <span style={{ color: 'var(--border)', fontSize: 10 }}>no target</span>
              },
              exportValue: (r: RepStats) => r.targetRevenue > 0 ? Math.round((r.revenue / r.targetRevenue) * 100) : '',
            },
            {
              key: 'commission', label: 'Commission', priority: 1, width: '100px',
              render: (r: RepStats) => <span style={{ fontWeight: 700, color: r.commission > 0 ? 'var(--warning-text)' : 'var(--text-3)' }}>{fmtKes(r.commission)}</span>,
              exportValue: (r: RepStats) => r.commission,
            },
          ] as ColumnDef<RepStats>[]}
          rows={repStats}
          rowKey={r => r.userId}
          hideSearch
          emptyMessage="No POS or sale-order activity for this period."
          onRowClick={r => setSelectedRep(r.userId)}
          exportTitle="Rep Performance"
          exportFilename="rep-performance"
        />
      </div>

      {/* Commission summary */}
      <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 12, padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning-text)', marginBottom: 10 }}>Commission Summary — {fmtPeriodLabel(periodKey)}</p>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {repStats.filter(r => r.commission > 0).map(r => (
            <div key={r.userId} style={{ fontSize: 11, color: 'var(--warning-text)' }}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>: {fmtKes(r.commission)}
            </div>
          ))}
          {repStats.every(r => r.commission === 0) && (
            <p style={{ fontSize: 11, color: 'var(--warning)' }}>No commissions earned this period.</p>
          )}
          <div style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--warning-text)', fontSize: 12 }}>
            Total: {fmtKes(repStats.reduce((s, r) => s + r.commission, 0))}
          </div>
        </div>
        <p style={{ fontSize: 9, color: 'var(--warning-text)', marginTop: 8 }}>
          Commission is zero until a product or category rate is set. Sales totals still count. Breakdown in{' '}
          <Link href="/finance?tab=commissions" className="underline underline-offset-2">Finance → Salespeople</Link>.
        </p>
      </div>
      </>)}

    </div>
  )
}
