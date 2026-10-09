'use client'
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { Modal, Field, Input, Select } from '@/components/ui'
import { exportToCsv } from '@/lib/export-utils'
import {
  buildPayeReturn, buildNssfReturn, buildShifReturn, buildHousingLevyReturn,
  buildBankPaymentFile, buildMpesaPaymentFile, buildP9, buildAnnualSummary, type CsvTable,
} from '@/lib/hr/statutory-exports'
import { buildP9Pdf } from '@/lib/hr/payslip-pdf'
import type { StatutoryReport, AnnualEmployeeRow } from '@/lib/hr/payroll-report-types'

const save = (t: CsvTable) => exportToCsv(t.headers, t.rows, t.filename)

/** Monthly statutory schedules and salary payment files for one payroll run. */
export function StatutoryFilesModal({ runId, runRef, onClose }: { runId: string; runRef: string; onClose: () => void }) {
  const { showToast } = useApp()
  const [report, setReport] = useState<StatutoryReport | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/payroll/${runId}/statutory`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Could not load payroll details')
        if (!cancelled) setReport(body as StatutoryReport)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load payroll details') })
    return () => { cancelled = true }
  }, [runId])

  const missing = (key: 'kraPin' | 'nssfNumber' | 'shaNumber') =>
    report ? report.rows.filter(r => !r[key]).map(r => r.employeeName) : []

  const withNotice = (t: CsvTable & { skipped?: string[] }) => {
    save(t)
    if (t.skipped?.length) showToast(`File saved. Left out: ${t.skipped.join('; ')}`, 'error')
  }

  const files: Array<{ label: string; hint: string; run: () => void; warn?: string[] }> = report ? [
    { label: 'PAYE return (P10 / iTax)', hint: 'Monthly PAYE schedule for KRA', run: () => save(buildPayeReturn(report)), warn: missing('kraPin').length ? [`No KRA PIN: ${missing('kraPin').join(', ')}`] : undefined },
    { label: 'NSSF schedule', hint: 'Employee + employer contributions', run: () => save(buildNssfReturn(report)), warn: missing('nssfNumber').length ? [`No NSSF number: ${missing('nssfNumber').join(', ')}`] : undefined },
    { label: 'SHIF schedule', hint: 'SHA contributions (uses the SHIF number on the employee)', run: () => save(buildShifReturn(report)), warn: missing('shaNumber').length ? [`No SHIF number: ${missing('shaNumber').join(', ')}`] : undefined },
    { label: 'Housing levy schedule', hint: 'Employee + employer levy', run: () => save(buildHousingLevyReturn(report)) },
    { label: 'Bank salary file', hint: 'Staff paid by bank transfer', run: () => withNotice(buildBankPaymentFile(report)) },
    { label: 'M-Pesa salary file', hint: 'Staff paid by M-Pesa (bulk upload)', run: () => withNotice(buildMpesaPaymentFile(report)) },
  ] : []

  return (
    <Modal title="Statutory & payment files" subtitle={`${runRef} · CSV downloads`} onClose={onClose} width={520}>
      {error && <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      {!report && !error && <p className="text-[12px]" style={{ color: 'var(--text-4)' }}>Loading payroll details…</p>}
      {report && (
        <div className="flex flex-col gap-2">
          {report.run.status === 'pending_approval' && (
            <p className="text-[11px] rounded-lg p-2" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
              This run is not approved yet. Figures can still change, so treat these files as drafts.
            </p>
          )}
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{report.rows.length} employees · Gross {report.totals.gross.toLocaleString('en-KE')} · PAYE {report.totals.paye.toLocaleString('en-KE')} · Net {report.totals.net.toLocaleString('en-KE')}</p>
          {files.map(f => (
            <div key={f.label} className="flex items-center justify-between gap-3 rounded-lg p-3" style={{ border: '1px solid var(--border-lt)' }}>
              <div>
                <div className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>{f.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-4)' }}>{f.hint}</div>
                {f.warn?.map(w => <div key={w} className="text-[10px]" style={{ color: 'var(--warning-text)' }}>{w}</div>)}
              </div>
              <button className="btn-outline text-[11px]" onClick={f.run}>Download CSV</button>
            </div>
          ))}
          <p className="text-[10px]" style={{ color: 'var(--text-4)' }}>Check the column order against the current iTax, NSSF and SHA upload templates before the first filing.</p>
        </div>
      )}
    </Modal>
  )
}

/** Annual P9 cards and the year-end PAYE summary. */
export function AnnualP9Modal({ onClose }: { onClose: () => void }) {
  const { showToast, companySettings } = useApp()
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [data, setData] = useState<AnnualEmployeeRow[] | null>(null)
  const [error, setError] = useState('')
  const [employeeId, setEmployeeId] = useState('')

  useEffect(() => {
    const y = Number(year)
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return
    let cancelled = false
    setData(null); setError('')
    fetch(`/api/payroll/annual?year=${y}`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Could not load annual payroll')
        if (!cancelled) { setData(body.employees as AnnualEmployeeRow[]); setEmployeeId('') }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load annual payroll') })
    return () => { cancelled = true }
  }, [year])

  const selected = data?.find(e => e.employeeId === employeeId) ?? null
  const y = Number(year)

  return (
    <Modal title="Annual P9 & PAYE summary" subtitle="Approved and posted payroll runs for the year" onClose={onClose} width={480}>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Year"><Input value={year} onChange={setYear} type="number" /></Field>
        {error && <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
        {!data && !error && <p className="text-[12px]" style={{ color: 'var(--text-4)' }}>Loading…</p>}
        {data && data.length === 0 && <p className="text-[12px]" style={{ color: 'var(--text-4)' }}>No approved payroll found for {year}.</p>}
        {data && data.length > 0 && (
          <>
            <Field label="Employee">
              <Select value={employeeId} onChange={setEmployeeId} options={[
                { value: '', label: 'Select employee…' },
                ...data.map(e => ({ value: e.employeeId, label: `${e.employeeName} (${e.employeeNo})` })),
              ]} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary text-[11px]" disabled={!selected} onClick={() => {
                if (!selected) return
                buildP9Pdf(selected, y, companySettings).save(`P9-${y}-${selected.employeeNo}.pdf`)
              }}>P9 card (PDF)</button>
              <button className="btn-outline text-[11px]" disabled={!selected} onClick={() => selected && save(buildP9(selected, y))}>P9 (CSV)</button>
              <button className="btn-outline text-[11px]" onClick={() => { save(buildAnnualSummary(data, y)); showToast('Annual PAYE summary downloaded', 'success') }}>All employees summary (CSV)</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
