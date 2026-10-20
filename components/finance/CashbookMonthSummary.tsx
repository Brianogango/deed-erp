'use client'

import { useMemo } from 'react'
import { fmtKes } from '@/lib/store'
import { buildCashbookMonthSummary, type SummaryRow } from '@/lib/accounting/cashbook-summary'
import { exportToExcel, exportToPDF, type ExportRow } from '@/lib/export-utils'

type Entry = Parameters<typeof buildCashbookMonthSummary>[0]['entries'][number]

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '')

function Section({ title, rows, total, totalLabel, showShare, noun = 'receipt' }: {
  title: string
  rows: SummaryRow[]
  total: number
  totalLabel: string
  showShare?: boolean
  noun?: string
}) {
  return (
    <section className="cashbook-summary__section">
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="cashbook-summary__empty">Nothing this month.</p>
      ) : (
        <table data-no-responsive className="cashbook-summary__table">
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td>{r.label}<span className="cashbook-summary__count">{r.count} {r.count === 1 ? noun : `${noun}s`}</span></td>
                {showShare && <td className="cashbook-summary__share">{pct(r.amount, total)}</td>}
                <td className="cashbook-summary__amount">{fmtKes(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{totalLabel}</td>
              {showShare && <td />}
              <td className="cashbook-summary__amount">{fmtKes(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}

/** Month-end report for the cashbook: sales by product line, money out by kind, balances by account. */
export default function CashbookMonthSummary({
  entries, month, monthName, bankAccounts, accountId, accountName,
}: {
  entries: Entry[]
  month: string
  monthName: string
  bankAccounts: Array<{ id: string; label: string; openingBalance: number }>
  accountId: string
  accountName: string
}) {
  const s = useMemo(
    () => buildCashbookMonthSummary({ entries, month, bankAccounts, accountId }),
    [entries, month, bankAccounts, accountId],
  )
  const otherInTotal = s.otherIn.reduce((t, r) => t + r.amount, 0)

  const exportRows = (): ExportRow[] => {
    const rows: ExportRow[] = []
    const line = (a: string, b: string | number = '', c: string | number = '') => rows.push([a, b, c])
    line(`Period: ${monthName}`, '', accountName)
    line('')
    line('Opening balance', '', s.opening)
    line('')
    line('SALES BY PRODUCT LINE', 'Share', 'Amount')
    s.sales.forEach(r => line(`  ${r.label} (${r.count})`, pct(r.amount, s.salesTotal), r.amount))
    line('Total sales received', '', s.salesTotal)
    if (s.otherIn.length) {
      line('')
      line('OTHER MONEY IN')
      s.otherIn.forEach(r => line(`  ${r.label} (${r.count})`, '', r.amount))
    }
    line('Total money in', '', s.moneyIn)
    line('')
    line('MONEY OUT')
    s.moneyOutRows.forEach(r => line(`  ${r.label} (${r.count})`, '', r.amount))
    line('Total money out', '', s.moneyOut)
    line('')
    line('Closing balance', '', s.closing)
    line('')
    line('BY ACCOUNT', 'Opening / In / Out', 'Closing')
    s.accounts.forEach(a => line(`  ${a.label}`, `${a.opening} / ${a.moneyIn} / ${a.moneyOut}`, a.closing))
    return rows
  }
  const filename = `cashbook-summary-${month}`
  const title = `Cashbook summary — ${monthName}`

  if (!month) {
    return (
      <div className="card p-6 text-xs" style={{ color: 'var(--text-3)' }}>
        Choose a month above to see its summary: sales by product line, money out and closing balances.
      </div>
    )
  }

  return (
    <div className="cashbook-summary card">
      <div className="cashbook-summary__head">
        <div>
          <p className="cashbook-summary__title">{monthName} — month summary</p>
          <p className="cashbook-summary__sub">{accountName} · money actually received and paid in the month</p>
        </div>
        <div className="cashbook-summary__actions">
          <button type="button" className="btn-secondary text-xs min-h-[40px] px-3" onClick={() => { void exportToExcel(title, ['Item', 'Share / detail', 'Amount (KES)'], exportRows(), filename) }}>Excel</button>
          <button type="button" className="btn-secondary text-xs min-h-[40px] px-3" onClick={() => { void exportToPDF(title, ['Item', 'Share / detail', 'Amount (KES)'], exportRows(), filename, 'portrait') }}>PDF</button>
        </div>
      </div>

      <div className="cashbook-summary__kpis">
        <div><span>Opening</span><strong>{fmtKes(s.opening)}</strong></div>
        <div><span>Money in</span><strong className="is-in">+{fmtKes(s.moneyIn)}</strong></div>
        <div><span>Money out</span><strong className="is-out">−{fmtKes(s.moneyOut)}</strong></div>
        <div><span>Closing</span><strong>{fmtKes(s.closing)}</strong></div>
      </div>

      <div className="cashbook-summary__grid">
        <div>
          <Section title="Sales by product line" rows={s.sales} total={s.salesTotal} totalLabel="Total sales received" showShare />
          {s.otherIn.length > 0 && (
            <Section title="Other money in" rows={s.otherIn} total={otherInTotal} totalLabel="Total other money in" />
          )}
        </div>
        <Section title="Money out" rows={s.moneyOutRows} total={s.moneyOut} totalLabel="Total money out" noun="payment" />
      </div>

      {s.accounts.length > 0 && (
        <section className="cashbook-summary__section">
          <h4>By account</h4>
          <div className="dt-scroll">
            <table data-no-responsive className="cashbook-summary__table cashbook-summary__table--accounts">
              <thead>
                <tr><th>Account</th><th>Opening</th><th>In</th><th>Out</th><th>Closing</th></tr>
              </thead>
              <tbody>
                {s.accounts.map(a => (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td className="cashbook-summary__amount">{fmtKes(a.opening)}</td>
                    <td className="cashbook-summary__amount is-in">{fmtKes(a.moneyIn)}</td>
                    <td className="cashbook-summary__amount is-out">{fmtKes(a.moneyOut)}</td>
                    <td className="cashbook-summary__amount">{fmtKes(a.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="cashbook-summary__note">
        Sales are split by what was sold: a line linked to a product uses its sales account, a line typed by hand is read
        from its description (an EliteBook counts as Laptops, an OptiPlex as Desktops). Anything not recognised is under Other sales.
      </p>
    </div>
  )
}
