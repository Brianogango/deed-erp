'use client'

import { useState } from 'react'
import { Modal, Field, Select } from '@/components/ui'
import { loadXlsx } from '@/lib/xlsx-lazy'
import { parseLeadRows, type ImportLead, type ImportProblem } from '@/lib/crm/lead-import'

const SOURCES = [
  { value: 'trade_show', label: 'Expo / trade show' },
  { value: 'cold_call', label: 'Call list' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'partner', label: 'Partner' },
  { value: 'walk_in', label: 'Walk-in' },
]

const FIELD_LABEL: Record<keyof ImportLead, string> = {
  name: 'Name', companyName: 'Company', email: 'Email', phone: 'Phone', notes: 'Notes',
}

/**
 * Load leads from a spreadsheet: preview what will be created and what is
 * wrong with which row before anything is saved.
 */
export default function LeadImportModal({
  canAssign,
  salesReps,
  onDone,
  onClose,
  showToast,
}: {
  canAssign: boolean
  salesReps: { id: string; name: string }[]
  onDone: () => void
  onClose: () => void
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [preview, setPreview] = useState<{ leads: ImportLead[]; problems: ImportProblem[]; columns: Partial<Record<keyof ImportLead, string>> } | null>(null)
  const [source, setSource] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ created: number; skippedExisting: string[]; problems: ImportProblem[] } | null>(null)

  async function readFile(file: File | undefined) {
    if (!file) return
    setResult(null)
    try {
      const XLSX = await loadXlsx()
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
      if (!data.length) { showToast('That sheet has no rows under the header', 'error'); return }
      setFileName(file.name)
      setRows(data)
      setPreview(parseLeadRows(data))
    } catch {
      showToast('Could not read that file — save it as .xlsx or .csv and try again', 'error')
    }
  }

  async function importNow() {
    if (!preview?.leads.length) return
    if (!source) { showToast('Choose where these leads came from', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, source, ...(canAssign ? { ownerId: ownerId || null } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setResult(data)
      showToast(`${data.created} lead${data.created === 1 ? '' : 's'} imported`, 'success')
      onDone()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const missingColumns = preview
    ? (['name', 'phone', 'email'] as const).filter(f => !preview.columns[f] && !(f === 'name' && preview.columns.companyName))
    : []

  return (
    <Modal title="Import leads" subtitle="From an .xlsx or .csv with a header row" onClose={onClose} width={680}>
      <div className="space-y-3 text-xs">
        <p className="text-[11px] text-t3">
          Columns are recognised by name: Name, Company, Phone (or Mobile), Email, Notes. Each lead needs a name or company and a phone or email.
          People who are already open leads are skipped.
        </p>
        <input
          type="file"
          aria-label="Spreadsheet"
          accept=".xlsx,.xls,.csv"
          className="text-[11px]"
          onChange={e => void readFile(e.target.files?.[0])}
        />

        {preview && !result && (
          <>
            <div className="rounded-xl border border-[var(--border-lt)] p-3 space-y-1">
              <p className="font-semibold text-t1">{fileName}: {preview.leads.length} lead{preview.leads.length === 1 ? '' : 's'} ready{preview.problems.length ? `, ${preview.problems.length} row${preview.problems.length === 1 ? '' : 's'} with problems` : ''}</p>
              <p className="text-[10px] text-t3">
                Using {(Object.keys(FIELD_LABEL) as (keyof ImportLead)[]).filter(f => preview.columns[f]).map(f => `${FIELD_LABEL[f]} ← "${preview.columns[f]}"`).join(' · ') || 'no recognised columns'}
              </p>
              {missingColumns.length > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--warning)' }}>No column found for: {missingColumns.map(f => FIELD_LABEL[f]).join(', ')}</p>
              )}
            </div>

            {preview.leads.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-xl border border-[var(--border-lt)]">
                <table className="w-full text-[11px]">
                  <thead><tr className="text-t3">{['Name', 'Company', 'Phone', 'Email'].map(h => <th key={h} className="text-left px-3 py-1.5">{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.leads.slice(0, 50).map((l, i) => (
                      <tr key={i} className="border-t border-[var(--border-lt)]">
                        <td className="px-3 py-1.5 text-t1">{l.name}</td><td className="px-3 py-1.5">{l.companyName}</td>
                        <td className="px-3 py-1.5">{l.phone}</td><td className="px-3 py-1.5">{l.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.leads.length > 50 && <p className="px-3 py-1.5 text-[10px] text-t3">…and {preview.leads.length - 50} more</p>}
              </div>
            )}

            {preview.problems.length > 0 && (
              <ul className="max-h-28 overflow-auto text-[10px] space-y-0.5" style={{ color: 'var(--danger)' }}>
                {preview.problems.slice(0, 50).map(p => <li key={p.row}>Row {p.row}: {p.problem}</li>)}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Where did they come from? *">
                <Select value={source} onChange={setSource} options={[{ value: '', label: 'Choose…' }, ...SOURCES]} />
              </Field>
              {canAssign && (
                <Field label="Give them to">
                  <Select value={ownerId} onChange={setOwnerId} options={[{ value: '', label: '— Unassigned —' }, ...salesReps.map(r => ({ value: r.id, label: r.name }))]} />
                </Field>
              )}
            </div>
          </>
        )}

        {result && (
          <div className="rounded-xl border border-[var(--border-lt)] p-3 space-y-1">
            <p className="font-semibold text-t1">{result.created} lead{result.created === 1 ? '' : 's'} imported, due for first contact today.</p>
            {result.skippedExisting.length > 0 && (
              <p className="text-[11px] text-t3">Skipped {result.skippedExisting.length} already open: {result.skippedExisting.slice(0, 15).join(', ')}{result.skippedExisting.length > 15 ? '…' : ''}</p>
            )}
            {result.problems.length > 0 && <p className="text-[11px] text-t3">{result.problems.length} row{result.problems.length === 1 ? '' : 's'} not imported (problems listed before import).</p>}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="btn-outline text-xs" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
        {!result && (
          <button type="button" className="btn-primary text-xs" disabled={saving || !preview?.leads.length} onClick={() => void importNow()}>
            {saving ? 'Importing…' : `Import ${preview?.leads.length ?? 0} lead${preview?.leads.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </Modal>
  )
}
