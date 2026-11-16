/**
 * Revenue by customer and by product for the sales dashboard.
 *
 * Pure. The dashboard reads sale orders and POS sales; the rules about what
 * counts, and how two records become one customer, live here so they can be
 * tested and so the panels cannot drift apart from each other.
 */

export interface CustomerSale {
  customerId?: string | null
  customerName?: string | null
  total: number
}

export interface CustomerRevenueRow {
  key: string
  name: string
  revenue: number
  orders: number
  /** A sale with no customer on it — a walk-in at the till. */
  unattributed: boolean
}

export const UNATTRIBUTED_KEY = '__no_customer__'
export const UNATTRIBUTED_LABEL = 'Walk-in (no customer recorded)'

const clean = (value: unknown): string => String(value ?? '').trim()
const money = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * One customer, however their sales were recorded. The id is used when there
 * is one; otherwise the name, so a sale typed without picking a contact still
 * lands on that customer instead of being dropped or lumped under a blank id
 * with everybody else's.
 */
export function customerKey(sale: CustomerSale): string {
  const id = clean(sale.customerId)
  if (id) return `id:${id}`
  const name = clean(sale.customerName)
  if (name) return `name:${name.toLowerCase().replace(/\s+/g, ' ')}`
  return UNATTRIBUTED_KEY
}

/** Every customer in the window, biggest first. Nothing is left out. */
export function customerRevenue(sales: CustomerSale[]): CustomerRevenueRow[] {
  const map = new Map<string, CustomerRevenueRow>()
  for (const sale of sales) {
    const key = customerKey(sale)
    const row = map.get(key) ?? {
      key,
      name: key === UNATTRIBUTED_KEY ? UNATTRIBUTED_LABEL : (clean(sale.customerName) || 'Unnamed customer'),
      revenue: 0,
      orders: 0,
      unattributed: key === UNATTRIBUTED_KEY,
    }
    row.revenue += money(sale.total)
    row.orders += 1
    // A later record with a name fills in one that was recorded without.
    if (!row.unattributed && row.name === 'Unnamed customer' && clean(sale.customerName)) {
      row.name = clean(sale.customerName)
    }
    map.set(key, row)
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue)
}

/**
 * The top customers, with what the ranking leaves off. `shown` and `total`
 * let the panel say so out loud, instead of a top-five that quietly disagrees
 * with the revenue chart beside it.
 */
export function topCustomerRevenue(sales: CustomerSale[], limit = 5): {
  rows: CustomerRevenueRow[]
  shown: number
  total: number
  others: number
  customers: number
} {
  const all = customerRevenue(sales)
  const rows = all.slice(0, limit)
  const total = all.reduce((sum, row) => sum + row.revenue, 0)
  const shown = rows.reduce((sum, row) => sum + row.revenue, 0)
  return { rows, shown, total, others: total - shown, customers: all.length }
}

/** The month keys (YYYY-MM) a window of `months` ending at `endMonth` covers. */
export function monthsInWindow(endMonth: string, months: number): string[] {
  const [y, m] = endMonth.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return []
  const keys: string[] = []
  for (let i = Math.max(1, months) - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export const REVENUE_WINDOWS = [
  { months: 1, label: 'This month' },
  { months: 3, label: 'Last 3 months' },
  { months: 6, label: 'Last 6 months' },
  { months: 12, label: 'Last 12 months' },
] as const

export type RevenueWindowMonths = typeof REVENUE_WINDOWS[number]['months']

/** "November 2026", or "Jun 26 – Nov 26" for a longer window. */
export function describeWindow(endMonth: string, months: number): string {
  const keys = monthsInWindow(endMonth, months)
  if (!keys.length) return ''
  const label = (key: string, long: boolean) => {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1).toLocaleDateString('en-KE', long
      ? { month: 'long', year: 'numeric' }
      : { month: 'short', year: '2-digit' })
  }
  if (keys.length === 1) return label(keys[0], true)
  return `${label(keys[0], false)} – ${label(keys[keys.length - 1], false)}`
}
