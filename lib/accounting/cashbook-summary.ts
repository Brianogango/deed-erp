/**
 * The cashbook's month-end report: what came in by product line (Laptops,
 * Desktops, Accessories…), what went out by kind, and each account's opening
 * and closing balance for the month.
 */

type Entry = {
  date: string
  bankAccountId: string
  debit: number
  credit: number
  sourceType: string
  category: string
  salesLines?: Array<{ code: string; name: string; amount: number }>
  billLines?: Array<{ key: string; name: string; amount: number }>
}

export type SummaryRow = { key: string; label: string; amount: number; count: number }
export type AccountRow = { id: string; label: string; opening: number; moneyIn: number; moneyOut: number; closing: number }

export type CashbookMonthSummary = {
  month: string
  opening: number
  moneyIn: number
  moneyOut: number
  closing: number
  /** Sales by product line, biggest first. */
  sales: SummaryRow[]
  salesTotal: number
  /** Other money in (customer deposits…). */
  otherIn: SummaryRow[]
  moneyOutRows: SummaryRow[]
  accounts: AccountRow[]
}

const round = (n: number) => Math.round(n * 100) / 100

const OUT_LABELS: Record<string, string> = {
  vendor_bill: 'Supplier payments',
  payroll: 'Salaries and wages',
  purchase: 'Purchases',
  pos: 'Till refunds',
  customer_invoice: 'Customer refunds',
  deposit: 'Deposit refunds',
}

function add(map: Map<string, SummaryRow>, key: string, label: string, amount: number) {
  const row = map.get(key) ?? { key, label, amount: 0, count: 0 }
  row.amount = round(row.amount + amount)
  row.count += 1
  map.set(key, row)
}

const sorted = (map: Map<string, SummaryRow>) => [...map.values()].filter(r => Math.abs(r.amount) >= 0.01).sort((a, b) => b.amount - a.amount)

export function buildCashbookMonthSummary(args: {
  entries: Entry[]
  month: string
  bankAccounts: Array<{ id: string; label: string; openingBalance: number }>
  /** One account's id, or 'all'. */
  accountId?: string
}): CashbookMonthSummary {
  const only = args.accountId && args.accountId !== 'all' ? args.accountId : null
  const accounts = args.bankAccounts.filter(a => !only || a.id === only)
  const byAccount = new Map<string, AccountRow>(accounts.map(a => [a.id, {
    id: a.id, label: a.label, opening: Number(a.openingBalance) || 0, moneyIn: 0, moneyOut: 0, closing: 0,
  }]))

  const sales = new Map<string, SummaryRow>()
  const otherIn = new Map<string, SummaryRow>()
  const out = new Map<string, SummaryRow>()

  for (const e of args.entries) {
    const row = byAccount.get(e.bankAccountId)
    if (!row) continue
    const ym = String(e.date ?? '').slice(0, 7)
    const net = (Number(e.credit) || 0) - (Number(e.debit) || 0)
    if (ym < args.month) { row.opening = round(row.opening + net); continue }
    if (ym !== args.month) continue

    if (net >= 0) {
      row.moneyIn = round(row.moneyIn + net)
      if ((e.sourceType === 'customer_invoice' || e.sourceType === 'pos') ) {
        const parts = e.salesLines?.length ? e.salesLines : [{ code: '5000', name: 'Other sales', amount: net }]
        for (const p of parts) add(sales, p.code, p.name, p.amount)
      } else if (e.sourceType === 'deposit') {
        add(otherIn, 'deposit', 'Customer deposits', net)
      } else {
        add(otherIn, e.sourceType, e.category || 'Other receipts', net)
      }
    } else {
      const amount = -net
      row.moneyOut = round(row.moneyOut + amount)
      if (e.sourceType === 'expense') add(out, `expense:${e.category}`, e.category || 'Expenses', amount)
      else if (e.sourceType === 'vendor_bill' && e.billLines?.length) {
        for (const p of e.billLines) add(out, `bill:${p.key}`, p.name === 'Supplier payment' ? 'Supplier payments' : `${p.name} (suppliers)`, p.amount)
      }
      else add(out, e.sourceType, OUT_LABELS[e.sourceType] ?? (e.category || 'Other payments'), amount)
    }
  }

  const accountRows = [...byAccount.values()].map(r => ({ ...r, closing: round(r.opening + r.moneyIn - r.moneyOut) }))
  const total = (k: 'opening' | 'moneyIn' | 'moneyOut' | 'closing') => round(accountRows.reduce((s, r) => s + r[k], 0))
  const salesRows = sorted(sales)
  return {
    month: args.month,
    opening: total('opening'),
    moneyIn: total('moneyIn'),
    moneyOut: total('moneyOut'),
    closing: total('closing'),
    sales: salesRows,
    salesTotal: round(salesRows.reduce((s, r) => s + r.amount, 0)),
    otherIn: sorted(otherIn),
    moneyOutRows: sorted(out),
    accounts: accountRows.filter(r => r.opening || r.moneyIn || r.moneyOut || r.closing),
  }
}
