'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type DashboardData = {
  meta: {
    companyName: string
    currency: string
    dateFrom: string
    dateTo: string
    asOf: string
    generatedAt: string
  }
  kpis: Array<{ id: string; label: string; value: number; change: number | null; tone: string }>
  revenueTrend: Array<{ month: string; label: string; revenue: number; expenses: number; profit: number }>
  cashTrend: Array<{ month: string; label: string; inflows: number; outflows: number; net: number }>
  ageing: {
    ar: AgeingTotals
    ap: AgeingTotals
  }
  banks: Array<{
    id: string
    name: string
    currency: string
    bookBalance: number | null
    bankBalance: number | null
    variance: number | null
    sharedGl: boolean
    status: 'reconciled' | 'items_pending' | 'no_statement'
  }>
  budget: {
    configured: boolean
    rows: Array<{ id: string; label: string; budget: number | null; actual: number }>
  }
  tax: {
    outputVat: number
    inputVat: number
    vatPayable: number
    withholdingVat: number
    etimsPending: number
    etimsLinked: number
    glDifference: number | null
  }
  profitLoss: {
    revenue: number
    otherIncome: number
    costOfSales: number
    grossProfit: number
    operatingExpenses: number
    operatingProfit: number
    financeCosts: number
    netProfit: number
  }
  balanceSheet: {
    totalAssets: number
    currentAssets: number
    nonCurrentAssets: number
    totalLiabilities: number
    currentLiabilities: number
    nonCurrentLiabilities: number
    equity: number
    balanced: boolean
  }
  payroll: {
    runReference: string | null
    totalGross: number
    totalNet: number
    obligations: Array<{ id: string; label: string; period: string; amount: number; dueDate: string; status: string }>
  }
  inventory: {
    closingValue: number
    totalQty: number
    productCount: number
    cogs: number
    turnover: number
    days: number | null
  }
  topCustomers: PartnerRow[]
  topVendors: PartnerRow[]
  recentTransactions: Array<{
    id: string
    date: string
    ref: string
    description: string
    module: string
    user: string
    amount: number
    status: string
  }>
  integrity: {
    passedCount: number
    failedCount: number
    allPassed: boolean
    total: number
  }
  checklist: {
    completed: number
    total: number
    items: Array<{ id: string; label: string; status: 'done' | 'attention'; detail: string | null }>
  }
  alerts: Array<{
    id: string
    severity: 'danger' | 'warning' | 'ok'
    label: string
    amount: number | null
    target: string
  }>
  cashFlow: {
    inflows: number
    outflows: number
    netChange: number
    openingCash: number
    closingCash: number
  }
}

type AgeingTotals = {
  balance: number
  current: number
  d30: number
  d60: number
  d90: number
  over90: number
}

type PartnerRow = {
  id: string
  name: string
  amount: number
  share: number
}

type Props = {
  onNavigate: (tab: string) => void
}

const kpiIcons: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  revenue: TrendingUp,
  grossProfit: CircleDollarSign,
  netProfit: BarChart3,
  cash: WalletCards,
  ar: UsersRound,
  ap: ReceiptText,
  vat: BadgeDollarSign,
  opex: Banknote,
}

const toneClass: Record<string, string> = {
  blue: 'is-blue',
  cyan: 'is-cyan',
  indigo: 'is-indigo',
  teal: 'is-teal',
  emerald: 'is-emerald',
  slate: 'is-slate',
  red: 'is-red',
  green: 'is-green',
}

function formatKes(value: number, compact = false) {
  const abs = Math.abs(value)
  const prefix = value < 0 ? '-' : ''
  if (compact) {
    if (abs >= 1_000_000_000) return `${prefix}KES ${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`
    if (abs >= 1_000_000) return `${prefix}KES ${(abs / 1_000_000).toFixed(abs >= 100_000_000 ? 1 : 2)}M`
    if (abs >= 1_000) return `${prefix}KES ${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`
  }
  return `${prefix}KES ${abs.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
}

function formatNumber(value: number) {
  return value.toLocaleString('en-KE', { maximumFractionDigits: 2 })
}

function formatDate(value: string) {
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function AnimatedAmount({ value, compact = true }: { value: number; compact?: boolean }) {
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    const duration = 650
    const startAt = performance.now()
    const startValue = 0
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setShown(startValue + (value - startValue) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return <>{formatKes(shown, compact)}</>
}

function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
  delay = 0,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <section
      className={`accounting-dashboard__panel accounting-dashboard__enter ${className}`}
      style={{ '--dash-delay': `${delay}ms` } as CSSProperties}
    >
      <div className="accounting-dashboard__panel-head">
        <div className="min-w-0">
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function AgeingPanel({ title, totals, kind, onNavigate }: {
  title: string
  totals: AgeingTotals
  kind: 'ar' | 'ap'
  onNavigate: (tab: string) => void
}) {
  const buckets = [
    ['Current', totals.current],
    ['1–30', totals.d30],
    ['31–60', totals.d60],
    ['61–90', totals.d90],
    ['90+', totals.over90],
  ] as const

  return (
    <button
      type="button"
      className="accounting-dashboard__ageing text-left accounting-dashboard__enter"
      onClick={() => onNavigate('ageing')}
      aria-label={`Open ${title}`}
    >
      <div className="accounting-dashboard__ageing-head">
        <div>
          <h3>{title}</h3>
          <p>Total {formatKes(totals.balance, true)}</p>
        </div>
        <span className={kind === 'ar' ? 'is-positive' : 'is-neutral'}>{kind.toUpperCase()}</span>
      </div>
      <div className="accounting-dashboard__ageing-grid">
        {buckets.map(([label, amount], index) => {
          const pct = totals.balance > 0 ? Math.round((amount / totals.balance) * 100) : 0
          return (
            <div key={label}>
              <span>{label}</span>
              <strong className={index === 0 ? 'is-positive' : ''}>{formatKes(amount, true).replace('KES ', '')}</strong>
              <small>{pct}%</small>
            </div>
          )
        })}
      </div>
    </button>
  )
}

function EmptyValue({ children = 'Not configured' }: { children?: ReactNode }) {
  return <span className="accounting-dashboard__muted-pill">{children}</span>
}

export default function AccountingDashboard({ onNavigate }: Props) {
  const now = new Date()
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-01-01`)
  const [dateTo, setDateTo] = useState(now.toISOString().slice(0, 10))
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, asOf: dateTo })
      const res = await fetch(`/api/accounting/dashboard?${params.toString()}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to load accounting dashboard')
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounting dashboard')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { void load() }, [load])

  const cashChart = useMemo(
    () => (data?.cashTrend || []).map(row => ({ ...row, outflowsNegative: -row.outflows })),
    [data?.cashTrend],
  )

  if (loading && !data) {
    return (
      <div className="accounting-dashboard accounting-dashboard--loading" aria-busy="true">
        <div className="accounting-dashboard__loading">
          <Loader2 className="animate-spin" size={24} />
          <strong>Building finance command centre…</strong>
          <span>Loading ledger, subledgers, tax, cash, payroll and reconciliation data.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="accounting-dashboard">
      <div className="accounting-dashboard__command accounting-dashboard__enter">
        <div className="accounting-dashboard__identity">
          <span className="accounting-dashboard__eyebrow">Finance command centre</span>
          <h2>Accounting Dashboard</h2>
          <p>Real-time overview of financial performance, liquidity, obligations and control exceptions.</p>
        </div>
        <div className="accounting-dashboard__filters">
          <label>
            <span>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
          <button type="button" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="accounting-dashboard__error" role="alert">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="accounting-dashboard__kpis">
            {data.kpis.map((kpi, index) => {
              const Icon = kpiIcons[kpi.id] || Activity
              const changePositive = kpi.change != null && kpi.change >= 0
              return (
                <button
                  type="button"
                  key={kpi.id}
                  className={`accounting-dashboard__kpi accounting-dashboard__enter ${toneClass[kpi.tone] || ''}`}
                  style={{ '--dash-delay': `${40 + index * 35}ms` } as CSSProperties}
                  onClick={() => {
                    if (kpi.id === 'ar') onNavigate('invoices')
                    else if (kpi.id === 'ap') onNavigate('bills')
                    else if (kpi.id === 'cash') onNavigate('cashbook')
                    else if (kpi.id === 'vat') onNavigate('vat')
                    else onNavigate('pl')
                  }}
                >
                  <span className="accounting-dashboard__kpi-icon"><Icon size={17} strokeWidth={2} /></span>
                  <span className="accounting-dashboard__kpi-copy">
                    <span>{kpi.label}</span>
                    <strong><AnimatedAmount value={kpi.value} /></strong>
                    {kpi.change == null ? (
                      <small>Selected period</small>
                    ) : (
                      <small className={changePositive ? 'is-positive' : 'is-negative'}>
                        {changePositive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                        {Math.abs(kpi.change).toFixed(1)}% vs prior period
                      </small>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="accounting-dashboard__top-grid">
            <Panel title="Revenue vs Expenses vs Profit Trend" subtitle="KES · rolling 12 months" className="accounting-dashboard__trend-panel" delay={120}>
              <div className="accounting-dashboard__chart-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.revenueTrend} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--finance-border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--finance-text-3)' }} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={v => formatKes(v, true).replace('KES ', '')} tick={{ fontSize: 9, fill: 'var(--finance-text-3)' }} width={54} />
                    <Tooltip formatter={(v: unknown) => formatKes(Number(Array.isArray(v) ? v[0] : v))} labelStyle={{ color: '#111827' }} />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2.2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} animationDuration={700} />
                    <Line type="monotone" dataKey="expenses" name="Expenses" stroke="#14b8a6" strokeWidth={2} dot={{ r: 2 }} animationDuration={850} />
                    <Line type="monotone" dataKey="profit" name="Net Profit" stroke="#172554" strokeWidth={2} dot={{ r: 2 }} animationDuration={1000} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="accounting-dashboard__legend">
                <span><i className="is-blue" />Revenue</span>
                <span><i className="is-teal" />Expenses</span>
                <span><i className="is-navy" />Net Profit</span>
              </div>
            </Panel>

            <Panel title="Cash Flow Overview" subtitle="KES · recent 6 months" className="accounting-dashboard__cash-panel" delay={160}>
              <div className="accounting-dashboard__chart-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={cashChart} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--finance-border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--finance-text-3)' }} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={v => formatKes(v, true).replace('KES ', '')} tick={{ fontSize: 9, fill: 'var(--finance-text-3)' }} width={54} />
                    <Tooltip formatter={(v: unknown) => formatKes(Number(Array.isArray(v) ? v[0] : v))} labelStyle={{ color: '#111827' }} />
                    <Bar dataKey="inflows" name="Cash Inflows" fill="#10b981" radius={[3, 3, 0, 0]} animationDuration={700} />
                    <Bar dataKey="outflowsNegative" name="Cash Outflows" fill="#ef4444" radius={[0, 0, 3, 3]} animationDuration={850} />
                    <Line type="monotone" dataKey="net" name="Net Cash" stroke="#2563eb" strokeWidth={2.2} dot={{ r: 2.5 }} animationDuration={1000} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="accounting-dashboard__legend">
                <span><i className="is-green" />Cash Inflows</span>
                <span><i className="is-red" />Cash Outflows</span>
                <span><i className="is-blue" />Net Cash</span>
              </div>
            </Panel>

            <div className="accounting-dashboard__ageing-stack">
              <AgeingPanel title="Accounts Receivable Aging" totals={data.ageing.ar} kind="ar" onNavigate={onNavigate} />
              <AgeingPanel title="Accounts Payable Aging" totals={data.ageing.ap} kind="ap" onNavigate={onNavigate} />
            </div>
          </div>

          <div className="accounting-dashboard__bank-wrap accounting-dashboard__enter">
            <div className="accounting-dashboard__bank-head">
              <div>
                <h3>Bank Balances & Reconciliation</h3>
                <p>Statement balance compared with posted book balance</p>
              </div>
              <button type="button" onClick={() => onNavigate('cashbook')}>View all banks</button>
            </div>
            <div className="accounting-dashboard__table-scroll">
              <table className="accounting-dashboard__table">
                <thead><tr><th>Bank account</th><th>Bank balance</th><th>Book balance</th><th>Variance</th><th>Status</th></tr></thead>
                <tbody>
                  {data.banks.length ? data.banks.slice(0, 6).map(bank => (
                    <tr key={bank.id}>
                      <td><strong>{bank.name}</strong><small>{bank.currency}</small></td>
                      <td>{bank.bankBalance == null ? '—' : formatKes(bank.bankBalance, true)}</td>
                      <td>{bank.bookBalance == null ? <span className="accounting-dashboard__shared-gl">Shared GL</span> : formatKes(bank.bookBalance, true)}</td>
                      <td className={bank.variance && Math.abs(bank.variance) > 1 ? 'is-negative' : ''}>{bank.variance == null ? '—' : formatKes(bank.variance, true)}</td>
                      <td><span className={`accounting-dashboard__status is-${bank.status}`}><i />{bank.status === 'reconciled' ? 'Reconciled' : bank.status === 'items_pending' ? 'Items pending' : 'No statement'}</span></td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5}><EmptyValue>No active bank accounts configured</EmptyValue></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="accounting-dashboard__middle-grid">
            <Panel
              title="Budget vs Actual (YTD)"
              subtitle={data.budget.configured ? 'Performance against approved budget' : 'Actuals are live · budget model not configured'}
              className="accounting-dashboard__budget-panel"
              delay={190}
              action={!data.budget.configured ? <EmptyValue>Budget setup required</EmptyValue> : null}
            >
              <div className="accounting-dashboard__budget-list">
                {data.budget.rows.map(row => {
                  const pct = row.budget && row.budget > 0 ? Math.min(130, (row.actual / row.budget) * 100) : 0
                  return (
                    <div className="accounting-dashboard__budget-row" key={row.id}>
                      <span>{row.label}</span>
                      <strong>{row.budget == null ? '—' : formatKes(row.budget, true)}</strong>
                      <strong>{formatKes(row.actual, true)}</strong>
                      <div className="accounting-dashboard__progress"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      <small>{row.budget == null ? 'No budget' : `${pct.toFixed(1)}%`}</small>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title="Tax & Compliance" subtitle="Statutory tax ledger and filing evidence" delay={220}>
              <div className="accounting-dashboard__tax-grid">
                <div className="accounting-dashboard__metric-list">
                  <div><span>VAT Collected</span><strong>{formatKes(data.tax.outputVat, true)}</strong></div>
                  <div><span>VAT Input (Recoverable)</span><strong>{formatKes(data.tax.inputVat, true)}</strong></div>
                  <div><span>VAT Payable</span><strong className={data.tax.vatPayable > 0 ? 'is-negative' : 'is-positive'}>{formatKes(data.tax.vatPayable, true)}</strong></div>
                  <div><span>Withholding VAT</span><strong>{formatKes(data.tax.withholdingVat, true)}</strong></div>
                </div>
                <div className="accounting-dashboard__filing-list">
                  <div><span>eTIMS linked</span><strong>{data.tax.etimsLinked}</strong><CheckCircle2 size={13} /></div>
                  <div className={data.tax.etimsPending ? 'is-warning' : ''}><span>Pending eTIMS</span><strong>{data.tax.etimsPending}</strong>{data.tax.etimsPending ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}</div>
                  <div className={data.tax.glDifference && Math.abs(data.tax.glDifference) > 1 ? 'is-warning' : ''}><span>VAT / GL difference</span><strong>{data.tax.glDifference == null ? '—' : formatKes(data.tax.glDifference, true)}</strong>{data.tax.glDifference && Math.abs(data.tax.glDifference) > 1 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}</div>
                </div>
              </div>
            </Panel>

            <Panel title="Profit & Loss Snapshot" subtitle={`${formatDate(data.meta.dateFrom)} – ${formatDate(data.meta.dateTo)}`} delay={250}>
              <div className="accounting-dashboard__statement">
                <div><span>Revenue</span><strong>{formatKes(data.profitLoss.revenue, true)}</strong></div>
                <div className="is-expense"><span>Cost of Sales</span><strong>({formatKes(Math.abs(data.profitLoss.costOfSales), true)})</strong></div>
                <div className="is-total"><span>Gross Profit</span><strong>{formatKes(data.profitLoss.grossProfit, true)}</strong></div>
                <div className="is-expense"><span>Operating Expenses</span><strong>({formatKes(Math.abs(data.profitLoss.operatingExpenses), true)})</strong></div>
                <div><span>Operating Profit</span><strong>{formatKes(data.profitLoss.operatingProfit, true)}</strong></div>
                <div><span>Other Income</span><strong>{formatKes(data.profitLoss.otherIncome, true)}</strong></div>
                <div className="is-expense"><span>Finance Costs</span><strong>({formatKes(Math.abs(data.profitLoss.financeCosts), true)})</strong></div>
                <div className="is-grand"><span>Net Profit</span><strong>{formatKes(data.profitLoss.netProfit, true)}</strong></div>
              </div>
            </Panel>

            <Panel title="Balance Sheet Snapshot" subtitle={`As at ${formatDate(data.meta.asOf)}`} delay={280}>
              <div className="accounting-dashboard__statement">
                <div className="is-section"><span>Assets</span><strong /></div>
                <div className="is-total"><span>Total Assets</span><strong>{formatKes(data.balanceSheet.totalAssets, true)}</strong></div>
                <div><span>Current Assets</span><strong>{formatKes(data.balanceSheet.currentAssets, true)}</strong></div>
                <div><span>Non-current Assets</span><strong>{formatKes(data.balanceSheet.nonCurrentAssets, true)}</strong></div>
                <div className="is-section"><span>Liabilities</span><strong /></div>
                <div className="is-total"><span>Total Liabilities</span><strong>{formatKes(data.balanceSheet.totalLiabilities, true)}</strong></div>
                <div><span>Current Liabilities</span><strong>{formatKes(data.balanceSheet.currentLiabilities, true)}</strong></div>
                <div><span>Non-current Liabilities</span><strong>{formatKes(data.balanceSheet.nonCurrentLiabilities, true)}</strong></div>
                <div className="is-grand"><span>Equity</span><strong>{formatKes(data.balanceSheet.equity, true)}</strong></div>
              </div>
            </Panel>
          </div>

          <div className="accounting-dashboard__operations-grid">
            <Panel title="Payroll & Statutory Obligations" subtitle={data.payroll.runReference || 'No posted payroll run'} delay={300}>
              <div className="accounting-dashboard__table-scroll">
                <table className="accounting-dashboard__table is-compact">
                  <thead><tr><th>Obligation</th><th>Period</th><th>Amount</th><th>Due date</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.payroll.obligations.length ? data.payroll.obligations.map(row => (
                      <tr key={row.id}>
                        <td><strong>{row.label}</strong></td>
                        <td>{row.period}</td>
                        <td>{formatKes(row.amount, true)}</td>
                        <td>{formatDate(row.dueDate)}</td>
                        <td>
                          <span className={row.status === 'settled' ? 'accounting-dashboard__status is-reconciled' : 'accounting-dashboard__due'}>
                            <i />{row.status === 'settled' ? 'Settled' : 'Due'}
                          </span>
                        </td>
                      </tr>
                    )) : <tr><td colSpan={5}><EmptyValue>No posted statutory payroll obligations</EmptyValue></td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Inventory & COGS" subtitle="Financial inventory position" delay={330}>
              <div className="accounting-dashboard__metric-list is-large">
                <div><span>Closing Inventory Value</span><strong>{formatKes(data.inventory.closingValue, true)}</strong></div>
                <div><span>COGS (selected period)</span><strong>{formatKes(data.inventory.cogs, true)}</strong></div>
                <div><span>Inventory Turnover</span><strong>{formatNumber(data.inventory.turnover)}×</strong></div>
                <div><span>Average Days in Inventory</span><strong>{data.inventory.days == null ? '—' : `${data.inventory.days} days`}</strong></div>
                <div><span>Valued Units</span><strong>{formatNumber(data.inventory.totalQty)}</strong></div>
              </div>
            </Panel>

            <Panel title="Top Customers" subtitle="By posted revenue" delay={360}>
              <PartnerTable rows={data.topCustomers} empty="No posted customer revenue in this period" />
            </Panel>

            <Panel title="Top Vendors" subtitle="By posted vendor bills" delay={390}>
              <PartnerTable rows={data.topVendors} empty="No posted vendor spend in this period" />
            </Panel>
          </div>

          <div className="accounting-dashboard__bottom-grid">
            <Panel title="Recent Transactions / Audit Trail" subtitle="Latest posted accounting activity" className="accounting-dashboard__recent-panel" delay={420}>
              <div className="accounting-dashboard__table-scroll">
                <table className="accounting-dashboard__table is-recent">
                  <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Module</th><th>User</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.recentTransactions.length ? data.recentTransactions.map(row => (
                      <tr key={row.id}>
                        <td>{formatDate(row.date)}</td>
                        <td><strong className="is-ref">{row.ref}</strong></td>
                        <td>{row.description}</td>
                        <td>{row.module.replaceAll('_', ' ')}</td>
                        <td>{row.user}</td>
                        <td>{formatKes(row.amount, true)}</td>
                        <td><span className="accounting-dashboard__status is-reconciled"><i />Posted</span></td>
                      </tr>
                    )) : <tr><td colSpan={7}><EmptyValue>No posted journals</EmptyValue></td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Month-End Checklist" subtitle={`${data.checklist.completed} / ${data.checklist.total} completed`} delay={450}>
              <div className="accounting-dashboard__check-progress">
                <div><i style={{ width: `${data.checklist.total ? (data.checklist.completed / data.checklist.total) * 100 : 0}%` }} /></div>
                <span>{data.checklist.total ? Math.round((data.checklist.completed / data.checklist.total) * 100) : 0}%</span>
              </div>
              <div className="accounting-dashboard__checklist">
                {data.checklist.items.map(item => (
                  <button type="button" key={item.id} onClick={() => onNavigate('integrity')}>
                    {item.status === 'done' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    <span>{item.label}</span>
                    <strong>{item.status === 'done' ? 'Done' : 'Attention'}</strong>
                  </button>
                ))}
              </div>
              <button type="button" className="accounting-dashboard__panel-link" onClick={() => onNavigate('integrity')}>View finance integrity</button>
            </Panel>

            <Panel
              title="Finance Alerts & Exceptions"
              subtitle={data.integrity.allPassed ? 'No critical integrity failures' : `${data.integrity.failedCount} integrity gate(s) failing`}
              delay={480}
              action={<span className={`accounting-dashboard__alert-count ${data.alerts.some(a => a.severity !== 'ok') ? 'is-active' : ''}`}>{data.alerts.filter(a => a.severity !== 'ok').length}</span>}
            >
              <div className="accounting-dashboard__alerts">
                {data.alerts.map(alert => (
                  <button type="button" key={alert.id} onClick={() => onNavigate(alert.target)}>
                    <span className={`accounting-dashboard__alert-icon is-${alert.severity}`}>{alert.severity === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}</span>
                    <span>{alert.label}</span>
                    <strong>{alert.amount == null ? '' : formatKes(alert.amount, true)}</strong>
                    <small>View</small>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          <div className="accounting-dashboard__foot accounting-dashboard__enter">
            <div>
              <ShieldCheck size={15} />
              <span>
                Finance integrity: <strong>{data.integrity.passedCount}/{data.integrity.total}</strong> controls passing
              </span>
            </div>
            <span>Updated {new Date(data.meta.generatedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </>
      ) : null}
    </div>
  )
}

function PartnerTable({ rows, empty }: { rows: PartnerRow[]; empty: string }) {
  return (
    <div className="accounting-dashboard__partner-table">
      {rows.length ? rows.map((row, index) => (
        <div key={row.id}>
          <span className="accounting-dashboard__rank">{index + 1}</span>
          <span className="accounting-dashboard__partner-name">{row.name}</span>
          <strong>{formatKes(row.amount, true)}</strong>
          <small>{row.share.toFixed(1)}%</small>
        </div>
      )) : <EmptyValue>{empty}</EmptyValue>}
    </div>
  )
}
