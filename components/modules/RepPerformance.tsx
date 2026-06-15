'use client'
import { useMemo, useState, useEffect } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { ModuleSkeleton } from '@/components/ui'

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

function currentMonthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function currentQuarterKey() {
  const d = new Date()
  const q = Math.ceil((d.getMonth() + 1) / 3)
  return `${d.getFullYear()}-Q${q}`
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
  if (key.includes('-Q')) {
    const [yr, q] = key.split('-Q')
    return `Q${q} ${yr}`
  }
  const [yr, mo] = key.split('-')
  return new Date(Number(yr), Number(mo) - 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

// ── Commission tiers (applied to monthly revenue) ────────────────────────────
// Tier 1: 0–100k  → 2%
// Tier 2: 100k–300k → 3%
// Tier 3: 300k+  → 4%
function calcCommission(revenue: number): number {
  if (revenue <= 0) return 0
  let commission = 0
  const tier1 = Math.min(revenue, 100_000)
  commission += tier1 * 0.02
  if (revenue > 100_000) {
    const tier2 = Math.min(revenue - 100_000, 200_000)
    commission += tier2 * 0.03
  }
  if (revenue > 300_000) {
    commission += (revenue - 300_000) * 0.04
  }
  return Math.round(commission)
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
  const { saleOrders, users, currentUserId, sops } = useApp()

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [periodMode, setPeriodMode] = useState<'month' | 'quarter'>('month')
  const [selectedPeriod, setSelectedPeriod] = useState(() =>
    periodMode === 'month' ? currentMonthKey() : currentQuarterKey()
  )
  const [selectedRep, setSelectedRep] = useState<string | null>(null)

  const currentUser = users.find(u => u.id === currentUserId)
  const isAdmin = currentUser?.role === 'director'

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
  const periodKey = periodOptions.includes(selectedPeriod) ? selectedPeriod : periodOptions[periodOptions.length - 1]
  const { start, end } = periodBounds(periodKey)
  const inPeriod = (d?: string) => !!d && d >= start && d <= end

  // Sales reps: all users who created orders, or have sales/admin role
  const repUsers = useMemo(() =>
    users.filter(u =>
      ['director', 'sales_rep', 'finance_officer'].includes(u.role ?? '') ||
      saleOrders.some(o => o.createdByUserId === u.id)
    ),
    [users, saleOrders]
  )

  // Compute per-rep stats for the selected period
  const repStats: RepStats[] = useMemo(() => {
    return repUsers.map(u => {
      const myOrders = saleOrders.filter(o => o.createdByUserId === u.id && inPeriod(o.date))
      const quotes   = myOrders.length
      const closed   = myOrders.filter(o => ['confirmed', 'delivered', 'invoiced'].includes(o.status))
      const revenue  = closed.reduce((s, o) => s + o.total, 0)
      const conv     = quotes === 0 ? 0 : Math.round((closed.length / quotes) * 100)
      const avg      = closed.length === 0 ? 0 : Math.round(revenue / closed.length)
      const commission = calcCommission(revenue)

      // SOP targets
      const sop = sops.find(s => s.userId === u.id && s.active)
      const targetRevenue = sop?.metrics.find(m => m.metricType === 'sales_revenue')?.target ?? 0
      const targetOrders  = sop?.metrics.find(m => m.metricType === 'sales_orders')?.target ?? 0

      return {
        userId: u.id,
        name: u.name,
        role: u.role ?? '',
        ordersCount: closed.length,
        quotesCount: quotes,
        revenue,
        conversionRate: conv,
        avgOrderValue: avg,
        commission,
        targetRevenue,
        targetOrders,
      }
    }).sort((a, b) => b.revenue - a.revenue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repUsers, saleOrders, sops, periodKey])

  // Trend: last 6 months per selected rep
  const repTrend = useMemo(() => {
    if (!selectedRep) return []
    return lastNMonths(6).map(mk => {
      const { start: s, end: e } = periodBounds(mk)
      const inM = (d?: string) => !!d && d >= s && d <= e
      const orders = saleOrders.filter(o =>
        o.createdByUserId === selectedRep &&
        ['confirmed', 'delivered', 'invoiced'].includes(o.status) &&
        inM(o.date)
      )
      return { month: mk, revenue: orders.reduce((sum, o) => sum + o.total, 0), count: orders.length }
    })
  }, [selectedRep, saleOrders])

  const detail = selectedRep ? repStats.find(r => r.userId === selectedRep) : null

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function pctBar(actual: number, target: number) {
    if (!target) return null
    const p = Math.min(100, Math.round((actual / target) * 100))
    const color = p >= 100 ? '#10B981' : p >= 70 ? '#F59E0B' : '#EF4444'
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6B7280', marginBottom: 2 }}>
          <span>{p}% of target</span>
          <span>Target: {target >= 1000 ? fmtKes(target) : target}</span>
        </div>
        <div style={{ height: 4, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${p}%`, background: color, borderRadius: 4, transition: 'width 0.4s' }} />
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────────────
  if (detail) {
    const maxRev = Math.max(...repTrend.map(t => t.revenue), 1)
    const repOrders = saleOrders
      .filter(o => o.createdByUserId === selectedRep && inPeriod(o.date))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)

    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => setSelectedRep(null)}
          style={{ alignSelf: 'flex-start', fontSize: 11, color: '#00B0D7', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Back to all reps
        </button>

        {/* Rep header */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #1B2762, #00B0D7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 16,
            }}>
              {detail.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{detail.name}</p>
              <p style={{ fontSize: 11, color: '#6B7280' }}>{detail.role.replace(/_/g, ' ')} · {fmtPeriodLabel(periodKey)}</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {[
              { label: 'Revenue', value: fmtKes(detail.revenue) },
              { label: 'Closed Orders', value: detail.ordersCount },
              { label: 'Quotes Created', value: detail.quotesCount },
              { label: 'Conversion', value: `${detail.conversionRate}%` },
              { label: 'Commission', value: fmtKes(detail.commission), highlight: true },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: kpi.highlight ? '#FEF3C7' : '#F9FAFB', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 9, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{kpi.label}</p>
                <p style={{ fontSize: 16, fontWeight: 700, color: kpi.highlight ? '#92400E' : '#111827' }}>{kpi.value}</p>
              </div>
            ))}
          </div>

          {/* Targets progress */}
          {(detail.targetRevenue > 0 || detail.targetOrders > 0) && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {detail.targetRevenue > 0 && (
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Revenue Target</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{fmtKes(detail.revenue)}</p>
                  {pctBar(detail.revenue, detail.targetRevenue)}
                </div>
              )}
              {detail.targetOrders > 0 && (
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Orders Target</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{detail.ordersCount} orders</p>
                  {pctBar(detail.ordersCount, detail.targetOrders)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Commission breakdown */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Commission Breakdown</p>
          <div style={{ fontSize: 11, color: '#374151', lineHeight: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6', paddingBottom: 4, marginBottom: 4 }}>
              <span>Revenue this period</span>
              <span style={{ fontWeight: 600 }}>{fmtKes(detail.revenue)}</span>
            </div>
            {detail.revenue > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Tier 1 (0–100k @ 2%)</span>
                  <span>{fmtKes(Math.min(detail.revenue, 100_000) * 0.02)}</span>
                </div>
                {detail.revenue > 100_000 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Tier 2 (100k–300k @ 3%)</span>
                    <span>{fmtKes(Math.min(detail.revenue - 100_000, 200_000) * 0.03)}</span>
                  </div>
                )}
                {detail.revenue > 300_000 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Tier 3 (300k+ @ 4%)</span>
                    <span>{fmtKes((detail.revenue - 300_000) * 0.04)}</span>
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', paddingTop: 8, marginTop: 4, fontWeight: 700, color: '#92400E', fontSize: 13 }}>
              <span>Total Commission</span>
              <span>{fmtKes(detail.commission)}</span>
            </div>
          </div>
        </div>

        {/* Revenue trend chart */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Revenue Trend (Last 6 Months)</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
            {repTrend.map(t => {
              const h = Math.max(4, Math.round((t.revenue / maxRev) * 72))
              return (
                <div key={t.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 8, color: '#6B7280' }}>{t.revenue > 0 ? fmtKes(t.revenue) : ''}</span>
                  <div style={{ width: '100%', height: h, background: t.month === periodKey ? '#1B2762' : '#00B0D7', borderRadius: '4px 4px 0 0', opacity: 0.85 }} title={`${fmtKes(t.revenue)}, ${t.count} orders`} />
                  <span style={{ fontSize: 9, color: '#9CA3AF' }}>{t.month.slice(5)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent orders */}
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Orders This Period</p>
          {repOrders.length === 0 ? (
            <p style={{ fontSize: 11, color: '#9CA3AF' }}>No orders in this period.</p>
          ) : (
            <div className="overflow-x-auto w-full">
              <table style={{ width: '100%', minWidth: 500, borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    {['Ref', 'Customer', 'Date', 'Status', 'Total'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#6B7280', fontWeight: 600, fontSize: 10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {repOrders.map(o => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #F9FAFB' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600, color: '#1B2762' }}>{o.ref}</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>{o.customerName}</td>
                      <td style={{ padding: '6px 8px', color: '#6B7280' }}>{fmtDate(o.date)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                          background: o.status === 'invoiced' ? '#DCFCE7' : o.status === 'delivered' ? '#DBEAFE' : o.status === 'confirmed' ? '#FEF9C3' : '#F3F4F6',
                          color: o.status === 'invoiced' ? '#166534' : o.status === 'delivered' ? '#1E40AF' : o.status === 'confirmed' ? '#854D0E' : '#374151',
                        }}>
                          {o.status}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', fontWeight: 600, color: '#111827', textAlign: 'right' }}>{fmtKes(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
        <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 2, gap: 2 }}>
          {(['month', 'quarter'] as const).map(m => (
            <button key={m} onClick={() => {
              setPeriodMode(m)
              setSelectedPeriod(m === 'month' ? currentMonthKey() : currentQuarterKey())
            }} style={{
              fontSize: 11, fontWeight: periodMode === m ? 700 : 400, padding: '4px 12px',
              borderRadius: 6, border: 'none', cursor: 'pointer',
              background: periodMode === m ? '#fff' : 'transparent',
              color: periodMode === m ? '#1B2762' : '#6B7280',
              boxShadow: periodMode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}>
              {m === 'month' ? 'Monthly' : 'Quarterly'}
            </button>
          ))}
        </div>
        <select
          value={periodKey}
          onChange={e => setSelectedPeriod(e.target.value)}
          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, border: '1px solid #D1D5DB', color: '#374151', background: '#fff' }}>
          {periodOptions.map(k => (
            <option key={k} value={k}>{fmtPeriodLabel(k)}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 4 }}>
          Team Total: <strong style={{ color: '#1B2762' }}>{fmtKes(totalRevenue)}</strong>
        </span>
      </div>

      {/* Leaderboard table */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Rep Performance — {fmtPeriodLabel(periodKey)}</p>
        </div>
        <div className="overflow-x-auto w-full">
          <table style={{ width: '100%', minWidth: 800, borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['#', 'Rep', 'Quotes', 'Closed', 'Conv.', 'Revenue', 'Avg Order', 'vs Target', 'Commission'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6B7280', fontWeight: 600, fontSize: 10, borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
          <tbody>
            {repStats.map((r, idx) => {
              const share = Math.round((r.revenue / maxRevenue) * 100)
              const revenueTarget = r.targetRevenue
              const targetPct = revenueTarget > 0 ? Math.min(150, Math.round((r.revenue / revenueTarget) * 100)) : null

              return (
                <tr
                  key={r.userId}
                  onClick={() => setSelectedRep(r.userId)}
                  style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F0F9FF'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: idx === 0 ? '#D97706' : '#9CA3AF', fontWeight: 700 }}>
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #1B2762, #00B0D7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 700, fontSize: 10, flexShrink: 0,
                      }}>
                        {r.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ fontWeight: 600, color: '#111827' }}>{r.name}</p>
                        <p style={{ fontSize: 9, color: '#9CA3AF' }}>{r.role.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#374151' }}>{r.quotesCount}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#1B2762' }}>{r.ordersCount}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                      background: r.conversionRate >= 70 ? '#DCFCE7' : r.conversionRate >= 40 ? '#FEF9C3' : '#FEE2E2',
                      color: r.conversionRate >= 70 ? '#166534' : r.conversionRate >= 40 ? '#854D0E' : '#991B1B',
                    }}>
                      {r.conversionRate}%
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <p style={{ fontWeight: 700, color: '#111827' }}>{fmtKes(r.revenue)}</p>
                    <div style={{ height: 3, background: '#E5E7EB', borderRadius: 2, marginTop: 3, width: '80%' }}>
                      <div style={{ height: '100%', width: `${share}%`, background: '#00B0D7', borderRadius: 2 }} />
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#374151' }}>{r.avgOrderValue > 0 ? fmtKes(r.avgOrderValue) : '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {targetPct !== null ? (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                        background: targetPct >= 100 ? '#DCFCE7' : targetPct >= 70 ? '#FEF9C3' : '#FEE2E2',
                        color: targetPct >= 100 ? '#166534' : targetPct >= 70 ? '#854D0E' : '#991B1B',
                      }}>
                        {targetPct}%
                      </span>
                    ) : <span style={{ color: '#D1D5DB', fontSize: 10 }}>no target</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: r.commission > 0 ? '#92400E' : '#9CA3AF' }}>
                    {r.commission > 0 ? fmtKes(r.commission) : '—'}
                  </td>
                </tr>
              )
            })}
            {repStats.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
                  No sales activity for this period.
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      </div>

      {/* Commission summary */}
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 10 }}>Commission Summary — {fmtPeriodLabel(periodKey)}</p>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {repStats.filter(r => r.commission > 0).map(r => (
            <div key={r.userId} style={{ fontSize: 11, color: '#78350F' }}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>: {fmtKes(r.commission)}
            </div>
          ))}
          {repStats.every(r => r.commission === 0) && (
            <p style={{ fontSize: 11, color: '#D97706' }}>No commissions earned this period.</p>
          )}
          <div style={{ marginLeft: 'auto', fontWeight: 700, color: '#92400E', fontSize: 12 }}>
            Total: {fmtKes(repStats.reduce((s, r) => s + r.commission, 0))}
          </div>
        </div>
        <p style={{ fontSize: 9, color: '#B45309', marginTop: 8 }}>
          Tiers: 0–100k @ 2% · 100k–300k @ 3% · 300k+ @ 4%
        </p>
      </div>

    </div>
  )
}
