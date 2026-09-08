'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataTable } from '@/components/data-table'
import { Modal } from '@/components/ui'
import { useUrlUiState } from '@/hooks/useUrlRecordId'
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
  const [asOf, setAsOf] = useUrlUiState('integrityAsOf', new Date().toISOString().slice(0, 10))
  const [gateSearch, setGateSearch] = useUrlUiState('integrityQ', '')
  const [gateStatus, setGateStatus] = useUrlUiState('integrityStatus', 'failed')
  const [selectedGate, setSelectedGate] = useState<Gate | null>(null)
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [certifying, setCertifying] = useState(false)

  const refresh = useCallback(async () => {
    setSelectedGate(null)
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
      throw err
    } finally {
      setCertifying(false)
    }
  }

  const visibleGates = useMemo(() => {
    const query = gateSearch.trim().toLowerCase()
    return [...(report?.gates ?? [])]
      .filter(gate => {
        if (gateStatus === 'failed' && gate.passed) return false
        if (gateStatus === 'passed' && !gate.passed) return false
        if (!query) return true
        return [gate.name, gate.detail, gate.id].some(value => String(value || '').toLowerCase().includes(query))
      })
      .sort((a, b) => Number(a.passed) - Number(b.passed))
  }, [gateSearch, gateStatus, report])

  const clearGateFilters = () => {
    setGateSearch('')
    setGateStatus('all')
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
        <>
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
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-t4">Find a control</span>
              <input
                className="form-input text-[11px]"
                value={gateSearch}
                onChange={event => setGateSearch(event.target.value)}
                placeholder="Search control name or explanation…"
              />
            </label>
            <label className="flex min-w-[150px] flex-col gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-t4">Result</span>
              <select className="form-select text-[11px]" value={gateStatus} onChange={event => setGateStatus(event.target.value)}>
                <option value="failed">Failed only</option>
                <option value="all">All controls</option>
                <option value="passed">Passed</option>
              </select>
            </label>
            {(gateSearch || gateStatus !== 'all') && (
              <button type="button" className="btn-secondary text-[11px]" onClick={clearGateFilters}>Clear filters</button>
            )}
            <span className="ml-auto self-center text-[10px] text-t3">{visibleGates.length} control{visibleGates.length === 1 ? '' : 's'} shown</span>
          </div>
        </>
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
          emptyMessage={loading ? 'Running integrity suite…' : report?.gates.length ? 'No controls match these filters' : 'No gate results yet'}
          rowKey={r => r.id}
          rows={visibleGates}
          onRowClick={gate => setSelectedGate(gate)}
          rowLabel={gate => `${gate.name}: ${gate.passed ? 'passed' : 'failed'}`}
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

      {selectedGate && (
        <Modal
          title={selectedGate.name}
          subtitle="Finance integrity control"
          onClose={() => setSelectedGate(null)}
          width={640}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--border-lt)] sm:grid-cols-3">
              <div className="bg-[var(--bg-surface)] p-3">
                <p className="text-[9px] uppercase tracking-wide text-t4">Result</p>
                <div className="mt-1">
                  <StatusBadge status={selectedGate.passed ? 'done' : 'cancelled'} label={selectedGate.passed ? 'Pass' : 'Fail'} size="xs" />
                </div>
              </div>
              <div className="border-t border-[var(--border-lt)] p-3 sm:border-l sm:border-t-0">
                <p className="text-[9px] uppercase tracking-wide text-t4">Difference</p>
                <p className={`mt-1 font-mono text-sm font-semibold ${Math.abs(selectedGate.difference) > 1 ? 'text-[var(--danger)]' : ''}`}>{fmtKes(selectedGate.difference)}</p>
              </div>
              <div className="border-t border-[var(--border-lt)] p-3 sm:border-l sm:border-t-0">
                <p className="text-[9px] uppercase tracking-wide text-t4">Population</p>
                <p className="mt-1 text-sm font-semibold">{selectedGate.populationCount}</p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-lt)] bg-[var(--bg-surface)] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-t4">What this check found</p>
              <p className="mt-1 text-xs text-t2">{selectedGate.detail || (selectedGate.passed ? 'The ledger and supporting records agree for this control.' : 'The ledger and supporting records do not agree for this control.')}</p>
            </div>

            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border-lt)]">
              <div className="p-3">
                <p className="text-[9px] uppercase tracking-wide text-t4">Ledger</p>
                <p className="mt-1 font-mono text-sm font-semibold">{fmtKes(selectedGate.ledgerAmount)}</p>
              </div>
              <div className="border-l border-[var(--border-lt)] p-3">
                <p className="text-[9px] uppercase tracking-wide text-t4">Subledger</p>
                <p className="mt-1 font-mono text-sm font-semibold">{fmtKes(selectedGate.subledgerAmount)}</p>
              </div>
            </div>

            <p className="text-[11px] text-t3">
              This view explains the exception only. Corrections must be made in the originating transaction or accounting workflow, then the gates should be run again.
            </p>

            <div className="flex justify-end">
              <button type="button" className="btn-primary text-[11px]" onClick={() => setSelectedGate(null)}>Back to controls</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}