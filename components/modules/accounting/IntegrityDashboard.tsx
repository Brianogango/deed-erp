'use client'

import { useCallback, useEffect, useState } from 'react'
import { DataTable } from '@/components/data-table'
import { PrimaryActionButton } from '@/components/erp'
import { fmtKes } from '@/lib/store'

type Gate = {
  id: string
  name: string
  passed: boolean
  ledgerAmount: number
  subledgerAmount: number
  difference: number
  populationCount: number
  detail?: string
}

type IntegrityReport = {
  asOf: string
  passedCount: number
  failedCount: number
  allPassed: boolean
  gates: Gate[]
}

export default function IntegrityDashboard() {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [certifying, setCertifying] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/accounting/integrity?asOf=${asOf}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to load integrity suite')
      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrity suite')
    } finally {
      setLoading(false)
    }
  }, [asOf])

  useEffect(() => { void refresh() }, [refresh])

  async function certify() {
    setCertifying(true)
    setError(null)
    try {
      const res = await fetch('/api/accounting/month-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodEnd: asOf }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Certification failed')
      setReport(data.integrity || report)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Certification failed')
    } finally {
      setCertifying(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1)]">Finance integrity</h2>
          <p className="text-xs text-[var(--text-3)]">
            Fifteen month-end control gates. Certification writes sign-off rows and is blocked while any gate fails.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="form-input text-[11px] py-1.5"
            value={asOf}
            onChange={e => setAsOf(e.target.value)}
            aria-label="Integrity as-of date"
          />
          <PrimaryActionButton onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Checking…' : 'Run gates'}
          </PrimaryActionButton>
          <PrimaryActionButton onClick={() => void certify()} disabled={certifying || !report}>
            {certifying ? 'Certifying…' : 'Certify month-end'}
          </PrimaryActionButton>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900" role="alert">
          {error}
        </div>
      )}

      {report && (
        <div className="flex items-center gap-2">
          <span className={`badge ${report.allPassed ? 'badge-green' : 'badge-red'}`}>
            {report.allPassed ? 'All gates passed' : `${report.failedCount} gate(s) failed`}
          </span>
          <span className="text-xs text-[var(--text-3)]">
            {report.passedCount}/{report.gates.length} as of {report.asOf}
          </span>
        </div>
      )}

      <DataTable
        tableId="finance-integrity-gates"
        hideSearch
        perPage={20}
        emptyMessage={loading ? 'Running integrity suite…' : 'No gate results yet'}
        rowKey={r => r.id}
        rows={report?.gates ?? []}
        columns={[
          { key: 'status', label: '', priority: 1, width: '72px', render: r => (
            <span className={`badge ${r.passed ? 'badge-green' : 'badge-red'}`}>{r.passed ? 'Pass' : 'Fail'}</span>
          ) },
          { key: 'name', label: 'Control', priority: 1, width: '2fr', render: r => (
            <div>
              <div className="font-semibold">{r.name}</div>
              {r.detail ? <div className="text-[11px] text-[var(--text-3)]">{r.detail}</div> : null}
            </div>
          ), accessor: r => r.name },
          { key: 'ledger', label: 'Ledger', priority: 2, width: '120px', align: 'right', render: r => <span className="font-mono">{fmtKes(r.ledgerAmount)}</span>, exportValue: r => r.ledgerAmount },
          { key: 'sub', label: 'Subledger', priority: 2, width: '120px', align: 'right', render: r => <span className="font-mono">{fmtKes(r.subledgerAmount)}</span>, exportValue: r => r.subledgerAmount },
          { key: 'diff', label: 'Difference', priority: 1, width: '120px', align: 'right', render: r => (
            <span className={`font-mono ${Math.abs(r.difference) > 1 ? 'text-red-700 font-bold' : ''}`}>{fmtKes(r.difference)}</span>
          ), exportValue: r => r.difference },
        ]}
        exportTitle="Finance integrity gates"
        exportFilename="finance-integrity"
      />
    </div>
  )
}
