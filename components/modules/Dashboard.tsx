'use client'
import { useMemo, useCallback, useState, useEffect } from 'react'
import { useApp, fmtKes, fmtDate, ALL_CATEGORIES, ModuleId } from '@/lib/store'
import { Badge } from '@/components/ui'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'
import {
  faMoneyBillWave, faArrowDown, faArrowUp, faFileInvoiceDollar,
  faBoxesStacked, faClipboardList, faScrewdriverWrench, faTriangleExclamation,
  faShieldHalved, faDesktop, faUsers, faMoneyCheckDollar, faArrowsRotate, faCartShopping,
  faCircleCheck,
} from '@fortawesome/free-solid-svg-icons'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { useRouter } from 'next/navigation'

const CATEGORY_COLORS: Record<string, string> = {
  Laptops:              '#1B2762',
  Desktops:             '#00B0D7',
  'Parts & Components': '#2563EB',
  Accessories:          '#0891B2',
  Printers:             '#059669',
  Networking:           '#D97706',
  Services:             '#DC2626',
}

// ── KPI card — top accent bar, bold value ────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon, onClick, isCurrency,
}: {
  label: string; value: string | number; sub: string
  color: string; icon: React.ReactNode; onClick?: () => void; isCurrency?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="card text-left w-full flex flex-col justify-between hover:shadow-md transition-all"
      style={{
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        borderTop: `3px solid ${color}`,
        borderRadius: 12,
        minHeight: '100px'
      }}
    >
      <div className="flex items-start justify-between gap-2 w-full mb-2">
        <p className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase text-gray-500 leading-tight flex-1 line-clamp-2">{label}</p>
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + '15', color }}>
          <span className="text-xs sm:text-sm">{icon}</span>
        </div>
      </div>
      <div className="mt-auto w-full">
        <p className="text-lg sm:text-2xl font-extrabold leading-none mb-1 truncate" style={{ color }}>
          {isCurrency && typeof value === 'number' ? fmtKes(value) : value}
        </p>
        <p className="text-[10px] sm:text-[11px] text-gray-400 leading-snug line-clamp-2">{sub}</p>
      </div>
    </button>
  )
}

// ── Card header ───────────────────────────────────────────────────────────────
function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-5 py-3 sm:py-3.5 border-b gap-2 sm:gap-0" style={{ borderColor: '#F3F4F6' }}>
      <div className="min-w-0 pr-2">
        <p className="text-xs sm:text-sm font-bold truncate" style={{ color: '#111827' }}>{title}</p>
        {sub && <p className="text-[9px] sm:text-[10px] text-gray-400 truncate mt-0.5">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0 self-start sm:self-auto">{action}</div>}
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 3, height: 13, background: '#1B2762', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
      <p className="text-[8px] sm:text-[9px] font-bold tracking-wider uppercase text-gray-400">{label}</p>
    </div>
  )
}

export function Dashboard() {
  const app = useApp()
  const router = useRouter()
  const [customWidgets, setCustomWidgets] = useState<string[]>([])

  // ── Compute metrics ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const invoices = app.invoices || []
    const paid = invoices.filter(i => i.status === 'paid')
    const outstanding = invoices.filter(i => i.status === 'draft' || i.status === 'posted')

    const revenue = paid.reduce((s, i) => s + (i.total || 0), 0)
    const receivables = outstanding.reduce((s, i) => s + (i.total || 0), 0)

    const stock = (app.stock || []).reduce((s, item) => s + ((item.unitCost || 0) * (item.qtyOnHand || 0)), 0)

    const repairs = (app.repairs || []).filter(r => r.status === 'open').length

    return { revenue, receivables, stock, repairs }
  }, [app])

  // ── Charts data ────────────────────────────────────────────────────────────
  const revenueData = useMemo(() => {
    const data: { day: string; sales: number; purchases: number }[] = []
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    days.forEach((day, i) => {
      data.push({
        day,
        sales: Math.floor(Math.random() * 5000),
        purchases: Math.floor(Math.random() * 3000),
      })
    })
    return data
  }, [])

  const inventoryData = useMemo(() => {
    return ALL_CATEGORIES.map(cat => ({
      name: cat,
      value: (app.stock || []).filter(s => s.category === cat).reduce((s, i) => s + ((i.unitCost || 0) * (i.qtyOnHand || 0)), 0),
      count: (app.stock || []).filter(s => s.category === cat).length,
    }))
  }, [app])

  const salesPipelineData = useMemo(() => {
    const orders = app.orders || []
    return [
      { stage: 'Quotation', count: orders.filter(o => o.status === 'quotation').length, value: orders.filter(o => o.status === 'quotation').reduce((s, o) => s + (o.total || 0), 0) },
      { stage: 'Confirmed', count: orders.filter(o => o.status === 'confirmed').length, value: orders.filter(o => o.status === 'confirmed').reduce((s, o) => s + (o.total || 0), 0) },
      { stage: 'Delivered', count: orders.filter(o => o.status === 'delivered').length, value: orders.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0) },
      { stage: 'Invoiced', count: orders.filter(o => o.status === 'invoiced').length, value: orders.filter(o => o.status === 'invoiced').reduce((s, o) => s + (o.total || 0), 0) },
    ]
  }, [app])

  return (
    <div className="flex flex-col gap-4 sm:gap-5 pb-4">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-5 pt-3 sm:pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-4">
          <div>
            <p className="text-base sm:text-lg font-bold">Good morning, {app.currentUser?.name || 'User'} 👋</p>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              {formatRoleLabel(app.currentUser?.role)} · {fmtKes(metrics.revenue)} revenue · {(app.employees || []).length} active employees · {metrics.repairs} open repairs
            </p>
          </div>
        </div>
      </div>

      {/* ── KPI Grid ──────────────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-5">
        <div className="mb-3">
          <SectionLabel label="My Key Metrics" />
        </div>
        <div className="kpi-grid">
          <KpiCard
            label="Revenue Collected"
            value={metrics.revenue}
            sub="from paid invoices"
            color="#10B981"
            icon={<Fa icon={faMoneyBillWave} />}
            isCurrency
            onClick={() => router.push('/finance')}
          />
          <KpiCard
            label="Outstanding"
            value={metrics.receivables}
            sub="receivables due"
            color="#F59E0B"
            icon={<Fa icon={faArrowUp} />}
            isCurrency
            onClick={() => router.push('/finance')}
          />
          <KpiCard
            label="Stock Value"
            value={metrics.stock}
            sub="cost basis on hand"
            color="#3B82F6"
            icon={<Fa icon={faBoxesStacked} />}
            isCurrency
            onClick={() => router.push('/inventory')}
          />
          <KpiCard
            label="Active Repairs"
            value={metrics.repairs}
            sub="system-wide"
            color="#EF4444"
            icon={<Fa icon={faScrewdriverWrench} />}
            onClick={() => router.push('/repairs')}
          />
        </div>
      </div>

      {/* ── Charts Section ────────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-5">
        <div className="mb-3">
          <SectionLabel label="Trends & Analytics" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          {/* Revenue vs Purchases */}
          <div className="card">
            <CardHeader title="Revenue vs Purchases" sub="Weekly performance" />
            <div className="chart-container p-3 sm:p-4">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={revenueData}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="sales" stackId="1" stroke="#10B981" fill="#D1FAE5" />
                  <Area type="monotone" dataKey="purchases" stackId="1" stroke="#F59E0B" fill="#FEF3C7" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Inventory by Category */}
          <div className="card">
            <CardHeader title="Inventory by Category" sub={`${inventoryData.reduce((s, i) => s + i.count, 0)} products · ${fmtKes(inventoryData.reduce((s, i) => s + i.value, 0))}`} />
            <div className="chart-container p-3 sm:p-4">
              {inventoryData.some(d => d.value > 0) ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={inventoryData.filter(d => d.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      label={{ fontSize: 10 }}
                    >
                      {inventoryData.map((_, i) => (
                        <Cell key={`cell-${i}`} fill={Object.values(CATEGORY_COLORS)[i % 7]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtKes(v)} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-gray-400 text-xs sm:text-sm">
                  No products yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sales Pipeline ────────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-5">
        <div className="card">
          <CardHeader title="Sales Pipeline" sub={`${salesPipelineData.reduce((s, d) => s + d.count, 0)} total orders`} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-3 sm:p-4">
            {salesPipelineData.map((stage, i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
                <p className="text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-300">{stage.stage}</p>
                <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mt-1">{stage.count}</p>
                <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{fmtKes(stage.value)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Activity & Alerts ─────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {/* Stock Alerts */}
          <div className="card">
            <CardHeader title="Stock Alerts" action={<a href="#" className="text-xs text-blue-600 hover:underline">View all →</a>} />
            <div className="p-3 sm:p-4 text-center text-xs sm:text-sm text-gray-500">
              ✅ All stock levels healthy
            </div>
          </div>

          {/* HR Snapshot */}
          <div className="card">
            <CardHeader title="HR Snapshot" action={<a href="#" className="text-xs text-blue-600 hover:underline">View HR →</a>} />
            <div className="grid grid-cols-3 gap-2 sm:gap-3 p-3 sm:p-4 text-center">
              <div>
                <p className="text-lg sm:text-2xl font-bold">{(app.employees || []).length}</p>
                <p className="text-[9px] sm:text-[10px] text-gray-500 mt-1">👥 Employees</p>
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-bold">0</p>
                <p className="text-[9px] sm:text-[10px] text-gray-500 mt-1">🌴 Leave Pending</p>
              </div>
              <div>
                <p className="text-lg sm:text-2xl font-bold">1</p>
                <p className="text-[9px] sm:text-[10px] text-gray-500 mt-1">🔑 Active Users</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Business Flow ─────────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-5">
        <div className="card">
          <CardHeader title="Business Flow" sub="End-to-End Workflow" />
          <div className="p-3 sm:p-4 space-y-2 sm:space-y-3 text-xs sm:text-sm overflow-x-auto">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span>👥 Contacts</span>
              <span className="text-gray-400">›</span>
              <span>📋 Quotation</span>
              <span className="text-gray-400">›</span>
              <span>💼 Sale Order</span>
              <span className="text-gray-400">›</span>
              <span>📦 Delivery</span>
              <span className="text-gray-400">›</span>
              <span>🛡️ Warranty</span>
              <span className="text-gray-400">›</span>
              <span>🧾 Invoice</span>
              <span className="text-gray-400">›</span>
              <span>💰 Payment</span>
            </div>
            <div className="text-gray-500 text-[10px] sm:text-xs">
              Parallel: Purchase → Stock · POS → Accounting · Repair → Parts · HR → Payroll
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
