import type { PayrollRun } from '@/lib/store'

export interface VarianceRow {
  employeeId: string
  employeeName: string
  kind: 'new' | 'left' | 'changed' | 'same'
  previousNet: number
  currentNet: number
  netChange: number
  grossChange: number
  deductionsChange: number
}

export interface PayrollVariance {
  previous: PayrollRun | null
  rows: VarianceRow[]
  totals: { gross: number; deductions: number; net: number; headcount: number }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const periodKey = (r: PayrollRun) => Number(r.year) * 100 + (Number(r.month) || 0)
const gross = (l: PayrollRun['lines'][number]) => (Number(l.basicSalary) || 0) + (Number(l.allowances) || 0)

/** The latest run strictly before `run`, by pay period. */
export function previousRun(run: PayrollRun, all: PayrollRun[]): PayrollRun | null {
  return [...all]
    .filter(r => r.id !== run.id && periodKey(r) < periodKey(run))
    .sort((a, b) => periodKey(b) - periodKey(a))[0] ?? null
}

/** Month-on-month comparison: who joined, who dropped off, and whose pay moved. */
export function comparePayrollRuns(run: PayrollRun, all: PayrollRun[]): PayrollVariance {
  const previous = previousRun(run, all)
  const prev = new Map((previous?.lines ?? []).map(l => [l.employeeId, l]))
  const curr = new Map(run.lines.map(l => [l.employeeId, l]))
  const rows: VarianceRow[] = []

  for (const [id, l] of curr) {
    const p = prev.get(id)
    const netChange = r2(l.netPay - (p?.netPay ?? 0))
    rows.push({
      employeeId: id, employeeName: l.employeeName,
      kind: !p ? 'new' : Math.abs(netChange) > 0.009 ? 'changed' : 'same',
      previousNet: p?.netPay ?? 0, currentNet: l.netPay, netChange,
      grossChange: r2(gross(l) - (p ? gross(p) : 0)),
      deductionsChange: r2(l.deductions - (p?.deductions ?? 0)),
    })
  }
  for (const [id, p] of prev) {
    if (curr.has(id)) continue
    rows.push({
      employeeId: id, employeeName: p.employeeName, kind: 'left',
      previousNet: p.netPay, currentNet: 0, netChange: r2(-p.netPay),
      grossChange: r2(-gross(p)), deductionsChange: r2(-p.deductions),
    })
  }
  const order = { new: 0, left: 1, changed: 2, same: 3 } as const
  rows.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.netChange) - Math.abs(a.netChange))

  return {
    previous,
    rows,
    totals: {
      gross: r2(run.totalGross - (previous?.totalGross ?? 0)),
      deductions: r2(run.totalDeductions - (previous?.totalDeductions ?? 0)),
      net: r2(run.totalNet - (previous?.totalNet ?? 0)),
      headcount: run.lines.length - (previous?.lines.length ?? 0),
    },
  }
}
