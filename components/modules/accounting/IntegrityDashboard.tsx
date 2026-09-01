'use client'

import { useCallback, useEffect, useState } from 'react'
import { DataTable } from '@/components/data-table'
import {
  AsyncActionButton,
  EmptyState,
  ErrorState,
  FormField,
  StatusBadge,
  WorkflowStageBar,
} from '@/components/erp'
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

  const workflowCurrent = !report ? 'run' : report.allPassed ? 'certify' : 'resolve'
  const blocker = report && !report.allPassed
    ? `${report.failedCount} control gate${report.failedCount === 1 ? '' : 's'} must be resolved before month-end certification.`
    : null

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1)]">Finance integrity</h2>
          <p className="text-xs text-[var(--text-3)]">
            Fifteen month-end control gates. Certification writes sign-off rows and is blocked while any gate fails.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="As-of date" className="min-w-[150px]">
            <input
              type="date"
              className="form-input text-[11px] py-1.5"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
            />
          </FormField>
          <AsyncActionButton
            action={refresh}
            pendingLabel="Checking…"
            disabled={loading || certifying}
          >
            Run gates
          </AsyncActionButton>
          <AsyncActionButton
            action={certify}
            pendingLabel="Certifying…"
            successLabel="Certified"
            disabled={certifying || loading || !report?.allPassed}
          >
            Certify month-end
          </AsyncActionButton>
        </div>
      </div>

      <WorkflowStageBar
        stages={[
          { id: 'run', label: 'Run controls', description: 'Evaluate all month-end gates' },
          { id: 'resolve', label: 'Resolve exceptions', description: 'Clear failed balances or controls' },
          { id: 'certify', label: 'Ready to certify', description: 'All gates must pass first' },
        ]}
        current={workflowCurrent}
        blocker={blocker}
      />

      {error && (
        <ErrorState
          title="Finance integrity check failed"
          description={error}
          retry={() => { void refresh() }}
          retryLabel="Run gates again"
        />
      )}

      {report && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={report.allPassed ? 'done' : 'cancelled'}
            label={report.allPassed ? 'All gates passed' : `${report.failedCount} gate(s) failed`}
            size="sm"
          />
          <span className="text-xs text-[var(--text-3)]">
            {report.passedCount}/{report.gates.length} controls passed as of {report.asOf}
          </span>
        </div>
      )}

      {!report && !loading ? (
        <EmptyState
          title="No integrity results yet"
          description="Choose an as-of date and run the month-end control gates before certification."
          action={(
            <AsyncActionButton action={refresh} pendingLabel="Checking…">
              Run gates
            </AsyncActionButton>
          )}
        />
      ) : (
        <DataTable
          tableId="finance-integrity-gates"
          hideSearch
          perPage={20}
          emptyMessage={loading ? 'Running integrity suite…' : 'No gate results yet'}
          rowKey={r => r.id}
          rows={report?.gates ?? []}
          columns={[
            {
              key: 'status', label: '', priority: 1, width: '88px', render: r => (
                <StatusBadge status={r.passed ? 'done' : 'cancelled'} label={r.passed ? 'Pass' : 'Fail'} size="xs" />
              ),
            },
            {
              key: 'name', label: 'Control', priority: 1, width: '2fr', render: r => (
                <div>
                  <div className="font-semibold">{r.name}</div>
                  {r.detail ? <div className="text-[11px] text-[var(--text-3)]">{r.detail}</div> : null}
                </div>
              ), accessor: r => r.name,
            },
            { key: 'ledger', label: 'Ledger', priority: 2, width: '120px', align: 'right', render: r => <span className="font-mono">{fmtKes(r.ledgerAmount)}</span>, exportValue: r => r.ledgerAmount },
            { key: 'sub', label: 'Subledger', priority: 2, width: '120px', align: 'right', render: r => <span className="font-mono">{fmtKes(r.subledgerAmount)}</span>, exportValue: r => r.subledgerAmount },
            {
              key: 'diff', label: 'Difference', priority: 1, width: '120px', align: 'right', render: r => (
                <span className={`font-mono ${Math.abs(r.difference) > 1 ? 'font-bold text-[var(--danger)]' : ''}`}>{fmtKes(r.difference)}</span>
              ), exportValue: r => r.difference,
            },
          ]}
          exportTitle="Finance integrity gates"
          exportFilename="finance-integrity"
        />
      )}
    </div>
  )
}
