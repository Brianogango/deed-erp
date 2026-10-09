'use client'
import { useMemo } from 'react'
import { useApp, fmtKes, type PayrollRun } from '@/lib/store'
import { Modal } from '@/components/ui'
import { comparePayrollRuns } from '@/lib/hr/payroll-variance'

const LABEL = { new: 'New', left: 'Left', changed: 'Changed', same: 'Same' } as const
const COLOR = { new: 'var(--success-text)', left: 'var(--danger)', changed: 'var(--warning-text)', same: 'var(--text-4)' } as const

/** Month-on-month comparison for a payroll run, to catch mistakes before approving. */
export function PayrollVarianceModal({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { payrollRuns } = useApp()
  const v = useMemo(() => comparePayrollRuns(run, payrollRuns), [run, payrollRuns])
  const move = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmtKes(Math.abs(n))}`
  const shown = v.rows.filter(r => r.kind !== 'same')

  return (
    <Modal title="Compare with previous month" subtitle={v.previous ? `${run.ref} vs ${v.previous.ref}` : run.ref} onClose={onClose} width={640}>
      {!v.previous ? (
        <p className="text-xs" style={{ color: 'var(--text-4)' }}>There is no earlier payroll run to compare with.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {([['Headcount', `${v.totals.headcount > 0 ? '+' : ''}${v.totals.headcount}`], ['Gross', move(v.totals.gross)], ['Deductions', move(v.totals.deductions)], ['Net pay', move(v.totals.net)]] as const).map(([k, val]) => (
              <div key={k} className="rounded-lg p-2" style={{ border: '1px solid var(--border-lt)' }}>
                <div style={{ color: 'var(--text-4)' }}>{k}</div>
                <div className="font-mono font-semibold">{val}</div>
              </div>
            ))}
          </div>
          {shown.length === 0 && <p className="text-xs" style={{ color: 'var(--text-3)' }}>No employee's pay changed since {v.previous.ref}.</p>}
          {shown.length > 0 && (
            <table className="w-full text-xs">
              <thead><tr style={{ color: 'var(--text-4)', textAlign: 'left' }}><th className="py-1">Employee</th><th>Change</th><th className="text-right">Previous net</th><th className="text-right">This net</th><th className="text-right">Difference</th></tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.employeeId} style={{ borderTop: '1px solid var(--border-lt)' }}>
                    <td className="py-1.5 font-semibold">{r.employeeName}</td>
                    <td style={{ color: COLOR[r.kind] }}>{LABEL[r.kind]}</td>
                    <td className="text-right font-mono">{fmtKes(r.previousNet)}</td>
                    <td className="text-right font-mono">{fmtKes(r.currentNet)}</td>
                    <td className="text-right font-mono" style={{ color: r.netChange < 0 ? 'var(--danger)' : 'var(--text-1)' }}>{move(r.netChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px]" style={{ color: 'var(--text-4)' }}>{v.rows.length - shown.length} employees are unchanged.</p>
        </div>
      )}
    </Modal>
  )
}
