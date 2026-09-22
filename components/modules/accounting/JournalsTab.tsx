'use client'
import { useMemo, useState } from 'react'
import { useAccounting } from './AccountingContext'
import { fmtDate, fmtKes, type JournalEntry } from '@/lib/store'
import { downloadPdf } from '@/lib/pdf'
import type { PdfLine } from '@/lib/pdf'
import { Badge, Modal } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { usePrismaAccountingReports } from '@/hooks/usePrismaAccountingReports'
import { useUrlUiState } from '@/hooks/useUrlRecordId'

type DraftLine = { account: string; description: string; debit: string; credit: string }

const emptyLine = (): DraftLine => ({ account: '', description: '', debit: '', credit: '' })

export default function JournalsTab() {
  const {
    journalEntries, journalDate, setJournalDate,
    journalSource, setJournalSource, journalRef, setJournalRef,
    viewJournal, setViewJournal, canViewJournals, hdr, showToast,
  } = useAccounting()

  const [sourceValue, setSourceValue] = useUrlUiState('journalBook', 'prisma')
  const source: 'blob' | 'prisma' = sourceValue === 'blob' ? 'blob' : 'prisma'
  const setSource = (next: 'blob' | 'prisma') => setSourceValue(next)
  const [journalStatus, setJournalStatus] = useUrlUiState('journalStatus', 'all')
  const [showManual, setShowManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [manualRef, setManualRef] = useState('')
  const [manualDate, setManualDate] = useState('')
  const [manualDesc, setManualDesc] = useState('')
  const [manualLines, setManualLines] = useState<DraftLine[]>([emptyLine(), emptyLine()])
  const prismaReports = usePrismaAccountingReports(source === 'prisma' && canViewJournals)

  const activeJournals = source === 'prisma' ? prismaReports.journals : journalEntries

  const filteredJournals = useMemo(() => {
    const q = journalRef.toLowerCase()
    return activeJournals.filter(e => {
      if (journalStatus !== 'all' && e.status !== journalStatus) return false
      if (journalDate && e.date !== journalDate) return false
      if (journalSource !== 'all' && e.source !== journalSource) return false
      if (q && !e.ref.toLowerCase().includes(q)) return false
      return true
    })
  }, [activeJournals, journalStatus, journalDate, journalSource, journalRef])

  const buildJournalPdf = (e: JournalEntry): PdfLine[] => hdr([
    { text: `Reference: ${e.ref}`,          x: 40, y: 710, size: 10, bold: true },
    { text: `Date: ${fmtDate(e.date)}`,     x: 40, y: 692, size: 10 },
    { text: `Source: ${e.source}`,          x: 40, y: 674, size: 10 },
    { text: `Description: ${e.description}`,x: 40, y: 656, size: 10 },
    { text: '—'.repeat(75), x: 40, y: 644, size: 10 },
    { text: 'Account',       x: 40,  y: 628, size: 10, bold: true },
    { text: 'Description',   x: 200, y: 628, size: 10, bold: true },
    { text: 'Debit (KSh)',   x: 360, y: 628, size: 10, bold: true },
    { text: 'Credit (KSh)',  x: 450, y: 628, size: 10, bold: true },
    ...e.lines.flatMap((l, i) => [
      { text: l.account,     x: 40,  y: 610 - i * 22, size: 10 },
      { text: l.description, x: 200, y: 610 - i * 22, size: 9 },
      { text: l.debit  ? fmtKes(l.debit)  : '—', x: 360, y: 610 - i * 22, size: 10 },
      { text: l.credit ? fmtKes(l.credit) : '—', x: 450, y: 610 - i * 22, size: 10 },
    ] as PdfLine[]),
    { text: `Total Debit: ${fmtKes(e.totalDebit)}`,   x: 360, y: 200, size: 10, bold: true },
    { text: `Total Credit: ${fmtKes(e.totalCredit)}`, x: 450, y: 200, size: 10, bold: true },
  ] as PdfLine[], `JOURNAL ENTRY — ${e.ref}`, `Date: ${fmtDate(e.date)} · Source: ${e.source}`)

  const columns: ColumnDef<JournalEntry>[] = [
    {
      key: 'ref', label: 'Ref', priority: 1, width: '120px',
      render: e => <span className="font-mono text-[11px] font-semibold text-blue-500">{e.ref}</span>,
      accessor: e => e.ref,
      exportValue: e => e.ref,
    },
    {
      key: 'date', label: 'Date', priority: 2, width: '100px',
      render: e => <span className="text-[11px] text-t3">{fmtDate(e.date)}</span>,
      exportValue: e => e.date,
    },
    {
      key: 'description', label: 'Description', priority: 1, width: '1.6fr',
      render: e => <span>{e.description}</span>,
      exportValue: e => e.description,
    },
    {
      key: 'source', label: 'Source', priority: 2, width: '100px',
      render: e => <span className="capitalize text-[11px]">{e.source}</span>,
      exportValue: e => e.source,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '100px',
      render: e => <span className="font-mono text-[11px]">{fmtKes(e.totalDebit)}</span>,
      exportValue: e => e.totalDebit,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '90px',
      render: e => <Badge status={e.status} />,
      accessor: e => e.status,
      exportValue: e => e.status,
    },
  ]

  async function submitManualJournal() {
    const lines = manualLines
      .map(l => ({
        account: l.account.trim(),
        description: l.description.trim(),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }))
      .filter(l => l.account && (l.debit > 0 || l.credit > 0))
    const debit = lines.reduce((s, l) => s + l.debit, 0)
    const credit = lines.reduce((s, l) => s + l.credit, 0)
    const missing: string[] = []
    if (!manualRef.trim()) missing.push('Reference')
    if (!manualDate) missing.push('Date')
    if (!manualDesc.trim()) missing.push('Description')
    if (missing.length) {
      showToast?.(`Required: ${missing.join(', ')}`, 'error')
      return
    }
    if (lines.length < 2) {
      showToast?.('Add at least two balanced lines', 'error')
      return
    }
    if (Math.abs(debit - credit) > 0.02) {
      showToast?.(`Journal unbalanced: debit ${debit} ≠ credit ${credit}`, 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/accounting/journals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: manualRef.trim(),
          description: manualDesc.trim(),
          date: manualDate,
          sourceType: 'manual',
          lines,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`)
      showToast?.('Manual journal posted to Prisma', 'success')
      setShowManual(false)
      setManualRef('')
      setManualDate('')
      setManualDesc('')
      setManualLines([emptyLine(), emptyLine()])
      prismaReports.refresh?.()
    } catch (err: any) {
      showToast?.(err?.message || 'Could not post journal', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!canViewJournals) return null

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <select
          className="form-select text-[11px] py-1.5"
          style={{ width: 160 }}
          value={source}
          onChange={e => setSource(e.target.value as 'blob' | 'prisma')}
          aria-label="Journal data source"
        >
          <option value="prisma">Official: Prisma (KES posted)</option>
          <option value="blob">Legacy: client blob</option>
        </select>
        <input className="form-input text-[11px] py-1.5" style={{ width: 140 }} type="date"
          value={journalDate} onChange={e => setJournalDate(e.target.value)} />
        <select className="form-select text-[11px] py-1.5" style={{ width: 130 }}
          value={journalStatus} onChange={e => setJournalStatus(e.target.value)}
          aria-label="Entry status">
          <option value="all">All statuses</option>
          <option value="posted">Posted</option>
          <option value="draft">Draft</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="form-select text-[11px] py-1.5" style={{ width: 130 }}
          value={journalSource} onChange={e => setJournalSource(e.target.value)}
          aria-label="Entry source">
          <option value="all">All sources</option>
          <option value="payroll">Payroll</option>
          <option value="refund">Refund</option>
          <option value="sales">Sales</option>
          <option value="invoice">Invoice</option>
          <option value="expense">Expense</option>
          <option value="purchase">Purchase</option>
          <option value="manual">Manual</option>
          <option value="stock_receipt">Stock receipt</option>
          <option value="stock_delivery">Stock delivery</option>
          <option value="fx_revaluation">FX revaluation</option>
        </select>
        <input className="form-input text-[11px] py-1.5" style={{ width: 200 }}
          placeholder="Filter by reference..." value={journalRef} onChange={e => setJournalRef(e.target.value)} />
        {(journalDate || journalSource !== 'all' || journalStatus !== 'all' || journalRef) && (
          <button
            type="button"
            className="btn-secondary text-[11px] py-1.5 px-3"
            onClick={() => {
              setJournalDate('')
              setJournalSource('all')
              setJournalStatus('all')
              setJournalRef('')
            }}
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          className="btn-primary text-[11px] py-1.5 px-3 ml-auto"
          onClick={() => setShowManual(true)}
        >
          New manual journal
        </button>
        {source === 'prisma' && prismaReports.loading && (
          <span className="text-[11px] text-t3">Loading posted journals…</span>
        )}
        {source === 'prisma' && prismaReports.error && (
          <span className="text-[11px] text-red-500">{prismaReports.error}</span>
        )}
      </div>
      <div className="px-4 py-2 text-[11px] text-t3 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--border-lt)' }}>
        <p>Official books use Prisma posted journals. Client blob is a legacy mirror for migration — do not treat it as the source of truth.</p>
        <strong className="text-t2">{filteredJournals.length} entr{filteredJournals.length === 1 ? 'y' : 'ies'} shown</strong>
      </div>
      <DataTable
        tableId="journal-entries"
        columns={columns}
        rows={filteredJournals}
        rowKey={e => e.id}
        hideSearch
        emptyMessage={source === 'prisma' ? 'No posted Prisma journals yet' : 'No journal entries found'}
        onRowClick={e => setViewJournal(e)}
        rowActions={e => (
          <div className="flex gap-1">
            <button className="text-[9px] px-2 py-0.5 rounded bg-[#E8F3FA] border border-[#A8D4E8] text-brand-navy cursor-pointer"
              onClick={() => setViewJournal(e)}>View</button>
            <button className="text-[9px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-t2 cursor-pointer"
              onClick={() => downloadPdf(`${e.ref.replaceAll('/', '-')}.pdf`, buildJournalPdf(e))}>PDF</button>
          </div>
        )}
        exportTitle="Journal Entries"
        exportFilename="journals"
      />

      {viewJournal && (
        <Modal
          title={`Accounting entry ${viewJournal.ref}`}
          subtitle={`${fmtDate(viewJournal.date)} · ${viewJournal.source}`}
          onClose={() => setViewJournal(null)}
          width={760}
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 border border-[var(--border-lt)] rounded-lg overflow-hidden">
              <div className="p-3 bg-[var(--bg-surface)]">
                <p className="text-[9px] uppercase tracking-wide text-t4">Status</p>
                <div className="mt-1"><Badge status={viewJournal.status} /></div>
              </div>
              <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                <p className="text-[9px] uppercase tracking-wide text-t4">Total debit</p>
                <p className="mt-1 text-sm font-bold font-mono text-t1">{fmtKes(viewJournal.totalDebit)}</p>
              </div>
              <div className="p-3 border-t sm:border-t-0 sm:border-l border-[var(--border-lt)]">
                <p className="text-[9px] uppercase tracking-wide text-t4">Total credit</p>
                <p className="mt-1 text-sm font-bold font-mono text-t1">{fmtKes(viewJournal.totalCredit)}</p>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-t4 mb-1">Description</p>
              <p className="text-xs text-t1">{viewJournal.description || 'No description'}</p>
            </div>

            <div className="border border-[var(--border-lt)] rounded-lg overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-3 px-3 py-2 bg-[var(--bg-surface)] text-[9px] uppercase tracking-wide font-semibold text-t4">
                <span>Account and description</span>
                <span className="text-right">Debit</span>
                <span className="text-right">Credit</span>
              </div>
              <div className="divide-y divide-[var(--border-lt)]">
                {viewJournal.lines.map((line, index) => (
                  <div key={`${line.account}-${index}`} className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-3 px-3 py-2.5 text-[11px]">
                    <div className="min-w-0">
                      <p className="font-semibold text-t1 truncate" title={line.account}>{line.account}</p>
                      <p className="text-t3 truncate" title={line.description}>{line.description || '—'}</p>
                    </div>
                    <span className="text-right font-mono text-t1">{line.debit ? fmtKes(line.debit) : '—'}</span>
                    <span className="text-right font-mono text-t1">{line.credit ? fmtKes(line.credit) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-[11px]" onClick={() => setViewJournal(null)}>Back to entries</button>
              <button
                type="button"
                className="btn-primary text-[11px]"
                onClick={() => downloadPdf(`${viewJournal.ref.replaceAll('/', '-')}.pdf`, buildJournalPdf(viewJournal))}
              >
                Download PDF
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showManual && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4" onClick={() => !saving && setShowManual(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-full max-w-2xl bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-[var(--text-1)] mb-1">Manual journal entry</h3>
            <p className="text-[11px] text-t3 mb-4">Posts directly to Prisma (source: manual). Must balance.</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="text-[11px] space-y-1">
                <span className="font-semibold">Reference</span>
                <input className="form-input w-full text-[11px]" value={manualRef} onChange={e => setManualRef(e.target.value)} placeholder="JRN/ADJ/001" />
              </label>
              <label className="text-[11px] space-y-1">
                <span className="font-semibold">Date *</span>
                <input type="date" className="form-input w-full text-[11px]" value={manualDate} onChange={e => setManualDate(e.target.value)} />
              </label>
            </div>
            <label className="text-[11px] space-y-1 block mb-3">
              <span className="font-semibold">Description</span>
              <input className="form-input w-full text-[11px]" value={manualDesc} onChange={e => setManualDesc(e.target.value)} placeholder="Month-end adjustment" />
            </label>
            <div className="space-y-2 mb-3">
              {manualLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <input className="form-input text-[11px] col-span-4" placeholder="Account (e.g. 1800 - AR)" value={line.account}
                    onChange={e => setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, account: e.target.value } : l))} />
                  <input className="form-input text-[11px] col-span-4" placeholder="Line description" value={line.description}
                    onChange={e => setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, description: e.target.value } : l))} />
                  <input className="form-input text-[11px] col-span-2" type="number" placeholder="Debit" value={line.debit}
                    onChange={e => setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, debit: e.target.value } : l))} />
                  <input className="form-input text-[11px] col-span-2" type="number" placeholder="Credit" value={line.credit}
                    onChange={e => setManualLines(prev => prev.map((l, i) => i === idx ? { ...l, credit: e.target.value } : l))} />
                </div>
              ))}
            </div>
            <button type="button" className="btn-secondary text-[11px] mb-4" onClick={() => setManualLines(prev => [...prev, emptyLine()])}>
              Add line
            </button>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary text-[11px]" disabled={saving} onClick={() => setShowManual(false)}>Cancel</button>
              <button type="button" className="btn-primary text-[11px]" disabled={saving} onClick={() => void submitManualJournal()}>
                {saving ? 'Posting…' : 'Post journal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
