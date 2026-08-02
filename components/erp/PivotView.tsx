'use client'

import { useMemo } from 'react'

type Row = Record<string, unknown>

type Props<T extends Row> = {
  data: T[]
  rowKey: keyof T & string
  colKey: keyof T & string
  valueKey: keyof T & string
  valueAggregator?: (values: number[]) => number
  rowLabel?: string
  colLabel?: string
  valueLabel?: string
  className?: string
  formatValue?: (n: number) => string
}

function defaultSum(values: number[]) {
  return values.reduce((s, v) => s + v, 0)
}

function cellKey(v: unknown) {
  if (v == null || v === '') return '—'
  return String(v)
}

export function PivotView<T extends Row>({
  data,
  rowKey,
  colKey,
  valueKey,
  valueAggregator = defaultSum,
  rowLabel,
  colLabel,
  valueLabel = 'Total',
  className,
  formatValue = n => n.toLocaleString('en-KE', { maximumFractionDigits: 0 }),
}: Props<T>) {
  const { rowKeys, colKeys, matrix, rowTotals, colTotals, grandTotal } = useMemo(() => {
    const rows = new Set<string>()
    const cols = new Set<string>()
    const buckets = new Map<string, number[]>()

    for (const row of data) {
      const rk = cellKey(row[rowKey])
      const ck = cellKey(row[colKey])
      const val = Number(row[valueKey]) || 0
      rows.add(rk)
      cols.add(ck)
      const key = `${rk}\0${ck}`
      const list = buckets.get(key) ?? []
      list.push(val)
      buckets.set(key, list)
    }

    const rowKeys = [...rows].sort()
    const colKeys = [...cols].sort()
    const matrix: Record<string, Record<string, number>> = {}
    const rowTotals: Record<string, number> = {}
    const colTotals: Record<string, number> = {}

    for (const rk of rowKeys) {
      matrix[rk] = {}
      const rowVals: number[] = []
      for (const ck of colKeys) {
        const vals = buckets.get(`${rk}\0${ck}`) ?? []
        const agg = valueAggregator(vals)
        matrix[rk][ck] = agg
        rowVals.push(agg)
        colTotals[ck] = (colTotals[ck] ?? 0) + agg
      }
      rowTotals[rk] = valueAggregator(rowVals)
    }

    const grandTotal = valueAggregator(Object.values(rowTotals))
    return { rowKeys, colKeys, matrix, rowTotals, colTotals, grandTotal }
  }, [data, rowKey, colKey, valueKey, valueAggregator])

  if (data.length === 0) {
    return (
      <p className={`text-[11px] text-[var(--text-4)] py-4 text-center ${className ?? ''}`}>
        No data for pivot
      </p>
    )
  }

  return (
    <div className={`dt-scroll ${className ?? ''}`}>
      <table data-no-responsive className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="text-left p-2 border-b border-[var(--border-lt)] text-[var(--text-3)] font-semibold sticky left-0 bg-[var(--bg-surface)]">
              {rowLabel ?? rowKey}
            </th>
            {colKeys.map(ck => (
              <th key={ck} className="text-right p-2 border-b border-[var(--border-lt)] text-[var(--text-3)] font-semibold whitespace-nowrap">
                {colLabel ? `${colLabel}: ` : ''}{ck}
              </th>
            ))}
            <th className="text-right p-2 border-b border-[var(--border-lt)] font-bold text-[var(--navy)]">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rowKeys.map(rk => (
            <tr key={rk}>
              <td className="p-2 border-b border-[var(--border-lt)] font-medium text-[var(--text-1)] sticky left-0 bg-[var(--bg-surface)]">
                {rk}
              </td>
              {colKeys.map(ck => (
                <td key={ck} className="p-2 border-b border-[var(--border-lt)] text-right font-mono text-[var(--text-2)]">
                  {formatValue(matrix[rk][ck] ?? 0)}
                </td>
              ))}
              <td className="p-2 border-b border-[var(--border-lt)] text-right font-mono font-semibold text-[var(--navy)]">
                {formatValue(rowTotals[rk] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="p-2 font-bold text-[var(--text-1)] sticky left-0 bg-[var(--bg-muted)]">{valueLabel}</td>
            {colKeys.map(ck => (
              <td key={ck} className="p-2 text-right font-mono font-semibold bg-[var(--bg-muted)]">
                {formatValue(colTotals[ck] ?? 0)}
              </td>
            ))}
            <td className="p-2 text-right font-mono font-bold text-[var(--navy)] bg-[var(--bg-muted)]">
              {formatValue(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default PivotView
