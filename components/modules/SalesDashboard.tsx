'use client'
import { useMemo, useState } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import SalesHeatmap from '@/components/crm/SalesHeatmap'

function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 100) }

function monthKey(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}
function fmtMonth(key: string) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-KE', { month: 'short', year: '2-digit' })
}
function fmtMonthFull(key: string) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
}

const CHART_COLORS = ['var(--ink-navy)', '#00B0D7', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444', '#6B7280']

export default function SalesDashboard() {
  const { saleOrders, invoices, contacts, products, deliveries } = useApp()

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const availableMonths = useMemo(() => {
    const set = new Set<string>()
    const d = new Date()
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    for (const o of saleOrders) {
      if (o.date) set.add(monthKey(o.date))
    }
    return Array.from(set).sort().reverse()
  }, [saleOrders])

  const lastMonth = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [selectedMonth])

  // ── Core KPIs ───────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    let thisMonthRev = 0, lastMonthRev = 0
    let totalInvoicedCount = 0, totalInvoicedValue = 0
    let pendingInvoice = 0
    let openQuotes = 0, confirmedCount = 0, allOrdersCount = 0

    for (const o of saleOrders) {
      if (o.status === 'cancelled') continue
      const mk = monthKey(o.date)

      if (mk === selectedMonth) {
        allOrdersCount++
        if (o.status === 'quotation') openQuotes++
        else confirmedCount++

        if (o.status === 'invoiced') {
          totalInvoicedCount++
          totalInvoicedValue += o.total
          thisMonthRev += o.total
        } else if (o.status === 'confirmed' || o.status === 'delivered') {
          pendingInvoice += o.total
        }
      } else if (mk === lastMonth && o.status === 'invoiced') {
        lastMonthRev += o.total
      }
    }

    const revGrowth      = lastMonthRev === 0 ? 100 : Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100)
    const convRate       = pct(confirmedCount, allOrdersCount)
    const avgOrder       = totalInvoicedCount > 0 ? Math.round(totalInvoicedValue / totalInvoicedCount) : 0

    return { thisMonthRev, lastMonthRev, revGrowth, convRate, avgOrder, pendingInvoice, openQuotes, totalInvoiced: totalInvoicedCount }
  }, [saleOrders, selectedMonth, lastMonth])

  // ── Monthly revenue (last 6 months) ────────────────────────────────────────
  const monthlyRevenue = useMemo(() => {
    const months: string[] = []
    const revMap = new Map<string, number>()
    const ordMap = new Map<string, number>()

    const [y, m] = selectedMonth.split('-').map(Number)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1)
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      months.push(mk)
      revMap.set(mk, 0)
      ordMap.set(mk, 0)
    }

    for (const o of saleOrders) {
      if (o.status === 'cancelled') continue
      const mk = monthKey(o.date)
      if (ordMap.has(mk)) {
        ordMap.set(mk, ordMap.get(mk)! + 1)
        if (o.status === 'invoiced') revMap.set(mk, revMap.get(mk)! + o.total)
      }
    }

    return months.map(mk => ({
      month: mk,
      label: fmtMonth(mk),
      revenue: revMap.get(mk) ?? 0,
      orders: ordMap.get(mk) ?? 0,
    }))
  }, [saleOrders, selectedMonth])

  const maxRev = Math.max(...monthlyRevenue.map(m => m.revenue), 1)

  // ── Top 5 products by revenue ───────────────────────────────────────────────
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; qty: number }>()
    for (const o of saleOrders) {
      if (o.status !== 'invoiced' || monthKey(o.date) !== selectedMonth) continue
      for (const l of o.lines) {
        const e = map.get(l.productId) ?? { name: l.productName, revenue: 0, qty: 0 }
        map.set(l.productId, { name: l.productName, revenue: e.revenue + l.subtotal, qty: e.qty + l.qty })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  }, [saleOrders, selectedMonth])

  const maxProdRev = Math.max(...topProducts.map(p => p.revenue), 1)

  // ── Top 5 customers by revenue ──────────────────────────────────────────────
  const topCustomers = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; orders: number }>()
    for (const o of saleOrders) {
      if (o.status !== 'invoiced' || monthKey(o.date) !== selectedMonth) continue
      const e = map.get(o.customerId) ?? { name: o.customerName, revenue: 0, orders: 0 }
      map.set(o.customerId, { ...e, revenue: e.revenue + o.total, orders: e.orders + 1 })
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  }, [saleOrders, selectedMonth])

  // ── Sales pipeline ──────────────────────────────────────────────────────────
  const pipeline = useMemo(() => {
    let qCount = 0, qVal = 0, cCount = 0, cVal = 0, dCount = 0, dVal = 0, iCount = 0, iVal = 0

    for (const o of saleOrders) {
      if (o.status === 'cancelled' || monthKey(o.date) !== selectedMonth) continue
      if (o.status === 'quotation') { qCount++; qVal += o.total }
      else if (o.status === 'confirmed') { cCount++; cVal += o.total }
      else if (o.status === 'delivered') { dCount++; dVal += o.total }
      else if (o.status === 'invoiced') { iCount++; iVal += o.total }
    }

    return [
      { label: 'Quotation', count: qCount, value: qVal, color: '#F59E0B' },
      { label: 'Confirmed', count: cCount, value: cVal, color: '#2E90FA' },
      { label: 'Delivered', count: dCount, value: dVal, color: '#8B5CF6' },
      { label: 'Invoiced',  count: iCount, value: iVal, color: '#12B76A' },
    ]
  }, [saleOrders, selectedMonth])

  // ── Recent orders ───────────────────────────────────────────────────────────
  const recentOrders = useMemo(() =>
    [...saleOrders]
      .filter(o => o.status !== 'cancelled' && monthKey(o.date) === selectedMonth)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8),
    [saleOrders, selectedMonth]
  )

  const STATUS_COLORS: Record<string, string> = {
    quotation: '#F59E0B', confirmed: '#2E90FA', delivered: '#8B5CF6', invoiced: '#12B76A', cancelled: '#9CA3AF',
  }

  return (
    <div className="mod-page">

      <div className="mod-header">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: '#8B5CF618', color: '#8B5CF6' }}>
            <span className="text-sm font-bold">$</span>
          </div>
          <h1 className="text-sm font-extrabold text-text-1">Sales Dashboard</h1>
        </div>
        <select
          className="form-select text-xs py-1.5 font-medium"
          style={{ width: 160 }}
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
        >
          {availableMonths.map(m => (
            <option key={m} value={m}>{fmtMonthFull(m)}</option>
          ))}
        </select>
      </div>

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">

      {/* KPI Row */}
      <div className="stat-grid-4">
        <div className="card p-4">
          <p className="text-10 text-t3 mb-1">Revenue This Month</p>
          <p className="text-xl font-bold text-t1">{fmtKes(kpis.thisMonthRev)}</p>
          <p style={{ fontSize: 10, marginTop: 4, color: kpis.revGrowth >= 0 ? '#059669' : '#DC2626', fontWeight: 600 }}>
            {kpis.revGrowth >= 0 ? '▲' : '▼'} {Math.abs(kpis.revGrowth)}% vs last month
          </p>
        </div>
        <div className="card p-4">
          <p className="text-10 text-t3 mb-1">Avg Order Value</p>
          <p className="text-xl font-bold text-t1">{fmtKes(kpis.avgOrder)}</p>
          <p className="text-10 text-t3 mt-1">from {kpis.totalInvoiced} invoiced orders</p>
        </div>
        <div className="card p-4">
          <p className="text-10 text-t3 mb-1">Pending Invoice</p>
          <p className="text-xl font-bold" style={{ color: '#8B5CF6' }}>{fmtKes(kpis.pendingInvoice)}</p>
          <p className="text-10 text-t3 mt-1">confirmed + delivered</p>
        </div>
        <div className="card p-4">
          <p className="text-10 text-t3 mb-1">Conversion Rate</p>
          <p className="text-xl font-bold text-t1">{kpis.convRate}%</p>
          <p className="text-10 text-t3 mt-1">{kpis.openQuotes} open quotations</p>
        </div>
      </div>

      {/* Revenue Chart + Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Monthly Revenue Bar Chart */}
        <div className="card p-4 lg:col-span-2">
          <p className="text-11 font-semibold text-t2 mb-4">Monthly Revenue — Last 6 Months</p>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRevenue} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v > 0 ? `${Math.round(v / 1000)}K` : '0'} />
                <Tooltip cursor={{ fill: '#F3F4F6' }} contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: 11, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }} formatter={(v: number) => [fmtKes(v), 'Revenue']} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {monthlyRevenue.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.month === selectedMonth ? 'var(--ink-navy)' : '#A8D4E8'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-3 pt-3 border-t text-10 text-t3" style={{ borderColor: '#F3F4F6' }}>
            <span>Orders this month: <strong className="text-t1">{monthlyRevenue.find(m => m.month === selectedMonth)?.orders ?? 0}</strong></span>
            <span>Last month: <strong className="text-t1">{fmtKes(kpis.lastMonthRev)}</strong></span>
          </div>
        </div>

        {/* Pipeline Funnel */}
        <div className="card p-4">
          <p className="text-11 font-semibold text-t2 mb-4">Sales Pipeline</p>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={pipeline} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="label" type="category" tick={{ fill: '#6B7280', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} width={65} />
                <Tooltip
                  cursor={{ fill: '#F3F4F6' }}
                  contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, fontSize: 11, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}
                  formatter={(val: number, name: string, props: any) => [fmtKes(val), `${props.payload.count} orders`]}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                  {pipeline.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 pt-3 border-t text-10 text-t3" style={{ borderColor: '#F3F4F6' }}>
            Total pipeline value: <strong className="text-t1">{fmtKes(pipeline.reduce((s, p) => s + p.value, 0))}</strong>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <SalesHeatmap />

      {/* Top Products + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* Top Products */}
        <div className="card p-4">
          <p className="text-11 font-semibold text-t2 mb-3">Top Products by Revenue</p>
          {topProducts.length === 0 ? (
            <p className="text-11 text-t3 py-6 text-center">No invoiced orders yet</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.name}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: CHART_COLORS[i] ?? '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700 }}>
                        {i + 1}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500 }} className="truncate max-w-[140px]">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <p style={{ fontSize: 10, fontWeight: 700 }}>{fmtKes(p.revenue)}</p>
                      <p style={{ fontSize: 9, color: '#9CA3AF' }}>{p.qty} units</p>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, width: `${pct(p.revenue, maxProdRev)}%`, background: CHART_COLORS[i] ?? '#E5E7EB', transition: 'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Customers */}
        <div className="card p-4">
          <p className="text-11 font-semibold text-t2 mb-3">Top Customers by Revenue</p>
          {topCustomers.length === 0 ? (
            <p className="text-11 text-t3 py-6 text-center">No invoiced orders yet</p>
          ) : (
            <div className="space-y-3">
              {topCustomers.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3">
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: CHART_COLORS[i] ?? '#E5E7EB',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
                  }}>
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: 11, fontWeight: 600 }} className="truncate">{c.name}</p>
                    <p style={{ fontSize: 9, color: '#9CA3AF' }}>{c.orders} order{c.orders !== 1 ? 's' : ''}</p>
                  </div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-navy)', whiteSpace: 'nowrap' }}>{fmtKes(c.revenue)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Orders */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-lt)' }}>
          <p className="text-11 font-semibold text-t2">Recent Orders</p>
          <p className="text-10 text-t3">Last 8 orders</p>
        </div>
        <div className="table-head" style={{ gridTemplateColumns: '100px 1.4fr 1fr 110px 80px', gap: 12 }}>
          {['Ref', 'Customer', 'Date', 'Total', 'Status'].map(h => <span key={h}>{h}</span>)}
        </div>
        {recentOrders.length === 0 ? (
          <p className="py-8 text-center text-xs text-t3">No orders yet</p>
        ) : recentOrders.map(o => (
          <div key={o.id} className="table-row" style={{ gridTemplateColumns: '100px 1.4fr 1fr 110px 80px', gap: 12 }}>
            <span className="font-mono text-11 font-semibold" style={{ color: 'var(--ink-navy)' }}>{o.ref}</span>
            <span className="text-xs font-medium truncate">{o.customerName}</span>
            <span className="text-xs text-t3">{fmtDate(o.date)}</span>
            <span className="text-xs font-mono font-semibold">{fmtKes(o.total)}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, display: 'inline-block',
              background: o.status === 'invoiced' ? '#DCFCE7' : o.status === 'confirmed' ? '#DBEAFE' : o.status === 'delivered' ? '#EDE9FE' : '#FEF9C3',
              color: STATUS_COLORS[o.status] ?? '#6B7280',
            }}>
              {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
            </span>
          </div>
        ))}
      </div>
      </div>{/* mod-body */}
    </div>
  )
}
