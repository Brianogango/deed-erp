'use client'

import { useEffect, useMemo, useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, Modal, Select, Textarea, Badge } from '@/components/ui'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { Fa } from '@/components/icons'
import { documentExpiry, expiryCounts } from '@/lib/hr/document-status'
import { PolicyAckReport } from './HRPolicies'
import { faGraduationCap, faPlus, faFileLines, faBuilding } from '@fortawesome/free-solid-svg-icons'

// ── Training ──────────────────────────────────────────────────────────────────
export function HRTrainingTab() {
  const { employees, trainingPrograms, employeeTrainings, addTrainingProgram, enrollEmployeeTraining, updateTrainingStatus } = useHrStore()
  const { showToast } = useApp()
  const [showProgram, setShowProgram] = useState(false)
  const [showEnroll, setShowEnroll] = useState<string | null>(null)
  const emptyProgramForm = () => ({ title: '', description: '', durationDays: '', mandatoryForNewHires: false })
  const [form, setForm] = useState(emptyProgramForm)
  const [enrollEmp, setEnrollEmp] = useState('')

  const empName = (id: string) => employees.find(e => e.id === id)?.fullName ?? 'Unknown'
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const saveProgram = () => {
    const missing: string[] = []
    if (!form.title.trim()) missing.push('Title')
    if (!form.durationDays.trim()) missing.push('Duration (days)')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    const durationDays = Number(form.durationDays)
    if (!Number.isFinite(durationDays) || durationDays <= 0) { showToast('Duration must be a number of days greater than zero', 'error'); return }
    addTrainingProgram({
      title: form.title.trim(),
      description: form.description.trim(),
      durationDays,
      mandatoryForNewHires: form.mandatoryForNewHires,
    })
    setForm(emptyProgramForm())
    setShowProgram(false)
  }

  const doEnroll = () => {
    if (!showEnroll) return
    if (!enrollEmp) { showToast('Please select an employee to enroll', 'error'); return }
    enrollEmployeeTraining(enrollEmp, showEnroll)
    setEnrollEmp('')
    setShowEnroll(null)
  }

  return (
    <div className="hr-submodule hr-training flex flex-col">
      <div className="hr-submodule-toolbar p-4 border-b border-[var(--border-lt)] flex items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2"><Fa icon={faGraduationCap} /> Training Programs</h3>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setForm(emptyProgramForm()); setShowProgram(true) }}><Fa icon={faPlus} /> New Program</button>
      </div>

      <div className="hr-training-grid hr-submodule-content p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {trainingPrograms.length === 0 && <p className="text-xs text-[var(--text-4)] col-span-full text-center py-10">No training programs yet</p>}
        {trainingPrograms.map(p => {
          const enrollments = employeeTrainings.filter(t => t.trainingId === p.id)
          const completed = enrollments.filter(t => t.status === 'completed').length
          return (
            <div key={p.id} className="hr-training-card rounded-xl border border-[var(--border-lt)] p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-[var(--text-1)]">{p.title}</p>
                {p.mandatoryForNewHires && <Badge status="pending" label="Mandatory" />}
              </div>
              <p className="text-[11px] text-[var(--text-3)] line-clamp-2">{p.description || 'No description'}</p>
              <p className="text-[10px] text-[var(--text-4)]">{p.durationDays} day(s) · {enrollments.length} enrolled · {completed} completed</p>
              <div className="flex flex-col gap-1 mt-1">
                {enrollments.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-[var(--text-2)] truncate">{empName(t.employeeId)}</span>
                    <Select
                      value={t.status}
                      onChange={v => updateTrainingStatus(t.id, v as any)}
                      options={[
                        { value: 'not_started', label: 'Not started' },
                        { value: 'in_progress', label: 'In progress' },
                        { value: 'completed', label: 'Completed' },
                      ]}
                    />
                  </div>
                ))}
              </div>
              <button className="btn-outline text-[11px] py-1 mt-1" onClick={() => { setEnrollEmp(''); setShowEnroll(p.id) }}>+ Enroll employee</button>
            </div>
          )
        })}
      </div>

      {showProgram && (
        <Modal title="New Training Program" onClose={() => setShowProgram(false)} width={480}>
          <div className="flex flex-col gap-4">
            <Field label="Title" required><Input value={form.title} onChange={set('title')} placeholder="e.g. Data Protection Induction" /></Field>
            <Field label="Description"><Textarea value={form.description} onChange={set('description')} rows={3} /></Field>
            <Field label="Duration (days)" required><Input type="number" value={form.durationDays} onChange={set('durationDays')} /></Field>
            <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
              <input type="checkbox" checked={form.mandatoryForNewHires} onChange={e => setForm(f => ({ ...f, mandatoryForNewHires: e.target.checked }))} />
              Mandatory for new hires
            </label>
            <div className="hr-modal-actions flex justify-end gap-2"><button className="btn-outline" onClick={() => setShowProgram(false)}>Cancel</button><button className="btn-primary" onClick={saveProgram}>Save</button></div>
          </div>
        </Modal>
      )}

      {showEnroll && (
        <Modal title="Enroll Employee" onClose={() => setShowEnroll(null)} width={420}>
          <div className="flex flex-col gap-4">
            <Field label="Employee" required>
              <Select value={enrollEmp} onChange={setEnrollEmp} options={[{ value: '', label: '— Select —' }, ...employees.filter(e => e.status === 'active').map(e => ({ value: e.id, label: e.fullName }))]} />
            </Field>
            <div className="hr-modal-actions flex justify-end gap-2"><button className="btn-outline" onClick={() => setShowEnroll(null)}>Cancel</button><button className="btn-primary" onClick={doEnroll}>Enroll</button></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── HR Documents ────────────────────────────────────────────────────────────
const DOC_TYPES = [
  { value: 'contract', label: 'Contract' },
  { value: 'nda', label: 'NDA' },
  { value: 'id_copy', label: 'ID Copy' },
  { value: 'certification', label: 'Certification' },
  { value: 'work_permit', label: 'Work Permit' },
  { value: 'other', label: 'Other' },
]

export function HRDocumentsTab({ prefill, onPrefillUsed }: { prefill?: { employeeId: string; type: string } | null; onPrefillUsed?: () => void } = {}) {
  const { employees, hrDocuments, addHRDocument } = useHrStore()
  const { showToast } = useApp()
  const [show, setShow] = useState(false)
  const emptyDocForm = () => ({ employeeId: '', type: '', title: '', expiryDate: '', notes: '', visibility: 'hr_only' })
  const [form, setForm] = useState(emptyDocForm)
  // Opened from a person's checklist ("Upload the signed contract"): the form starts filled in.
  useEffect(() => {
    if (!prefill) return
    const label = DOC_TYPES.find(t => t.value === prefill.type)?.label ?? ''
    const person = employees.find(e => e.id === prefill.employeeId)?.fullName ?? ''
    setForm({ ...emptyDocForm(), employeeId: prefill.employeeId, type: prefill.type, title: label && person ? `${label} — ${person}` : label })
    setShow(true)
    onPrefillUsed?.()
  }, [prefill]) // eslint-disable-line react-hooks/exhaustive-deps
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | 'attention'>('all')
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const empName = (id: string) => employees.find(e => e.id === id)?.fullName ?? '—'

  const readAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(f)
  })

  const save = async () => {
    const missing: string[] = []
    if (!form.employeeId) missing.push('Employee')
    if (!form.type) missing.push('Type')
    if (!form.title.trim()) missing.push('Title')
    if (missing.length) { showToast(`Please fill in: ${missing.join(', ')}`, 'error'); return }
    if (file && file.size > 4 * 1024 * 1024) { showToast('The file is larger than 4 MB', 'error'); return }
    if (saving) return
    setSaving(true)
    try {
      const doc = addHRDocument({
        employeeId: form.employeeId,
        type: form.type as any,
        title: form.title.trim(),
        expiryDate: form.expiryDate || undefined,
        visibility: form.visibility as 'hr_only' | 'hr_finance' | 'employee_visible',
        status: 'active',
        notes: form.notes.trim() || undefined,
        uploadedDate: new Date().toISOString(),
        ...(file ? { fileName: file.name, fileSize: file.size, fileType: file.type } : {}),
      })
      if (file) {
        const dataUrl = await readAsDataUrl(file)
        const res = await fetch(`/api/hr-documents/${doc.id}/file`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, fileName: file.name }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          showToast(`Document saved, but the file was not uploaded: ${body?.error || res.statusText}`, 'error')
        }
      }
      setForm(emptyDocForm())
      setFile(null)
      setShow(false)
    } finally {
      setSaving(false)
    }
  }

  const { expiring, expired } = expiryCounts(hrDocuments)
  /** Open the form for one person and type, filled in (Upload / Renew). */
  const openFor = (employeeId: string, type: string) => {
    const label = DOC_TYPES.find(t => t.value === type)?.label ?? ''
    setForm({ ...emptyDocForm(), employeeId, type, title: `${label} — ${empName(employeeId)}` })
    setShow(true)
  }
  // What HR has to do about papers, most urgent first: the two every
  // person must have on file, then anything expired or about to.
  const needs = [
    ...employees.filter(e => e.status !== 'exited').flatMap(e => (['contract', 'id_copy'] as const)
      .filter(type => !hrDocuments.some(d => d.employeeId === e.id && d.type === type))
      .map(type => ({ id: `${e.id}:${type}`, employeeId: e.id, type, what: type === 'contract' ? 'Signed contract' : 'ID copy', problem: 'Missing', tone: 'bad' as const, rank: 0, action: 'Upload' }))),
    ...hrDocuments
      .filter(d => employees.some(e => e.id === d.employeeId && e.status !== 'exited'))
      .map(d => ({ d, x: documentExpiry(d.expiryDate) }))
      .filter(({ x }) => x.status !== 'active')
      .map(({ d, x }) => ({
        id: d.id, employeeId: d.employeeId, type: d.type, what: d.title,
        problem: x.status === 'expired' ? 'Expired' : `Ends in ${x.daysLeft} days`,
        tone: x.status === 'expired' ? 'bad' as const : 'warn' as const, rank: x.status === 'expired' ? 1 : 2, action: 'Renew',
      })),
  ].sort((a, b) => a.rank - b.rank || empName(a.employeeId).localeCompare(empName(b.employeeId)))
  const [showAllNeeds, setShowAllNeeds] = useState(false)
  const visibleDocs = filter === 'attention'
    ? hrDocuments.filter(d => documentExpiry(d.expiryDate).status !== 'active')
    : hrDocuments

  const columns: ColumnDef<typeof hrDocuments[0]>[] = [
    { key: 'title', label: 'Title', priority: 1, render: d => <span className="font-semibold text-[var(--text-1)]">{d.title}</span>, exportValue: d => d.title },
    { key: 'employeeId', label: 'Employee', priority: 1, render: d => empName(d.employeeId), exportValue: d => empName(d.employeeId) },
    { key: 'visibility', label: 'Visible to', priority: 3, render: d => <span className="text-xs">{d.visibility === 'employee_visible' ? 'Employee' : d.visibility === 'hr_finance' ? 'HR + finance' : 'HR only'}</span>, exportValue: d => d.visibility },
    { key: 'type', label: 'Type', priority: 2, render: d => <span className="capitalize">{d.type.replace(/_/g, ' ')}</span>, exportValue: d => d.type },
    { key: 'expiryDate', label: 'Expiry', priority: 2, render: d => d.expiryDate ? fmtDate(d.expiryDate) : '—', exportValue: d => d.expiryDate ?? '' },
    {
      key: 'status', label: 'Status', priority: 1,
      render: d => {
        const e = documentExpiry(d.expiryDate)
        const label = e.status === 'expired' ? 'expired' : e.status === 'expiring' ? `expires in ${e.daysLeft}d` : 'active'
        return <Badge status={e.status === 'active' ? 'active' : e.status === 'expired' ? 'cancelled' : 'pending'} label={label} />
      },
      exportValue: d => documentExpiry(d.expiryDate).status,
    },
    {
      key: 'file', label: 'File', priority: 2,
      render: d => d.fileName
        ? <a className="text-primary-600 hover:underline text-xs" href={`/api/hr-documents/${d.id}/file`} target="_blank" rel="noreferrer">View</a>
        : <span className="text-xs text-[var(--text-4)]">None</span>,
      exportValue: d => d.fileName ?? '',
    },
  ]

  return (
    <div className="hr-submodule hr-documents flex flex-col">
      <div className="hr-submodule-toolbar p-4 border-b border-[var(--border-lt)] flex items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2"><Fa icon={faFileLines} /> HR Documents</h3>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setForm(emptyDocForm()); setShow(true) }}><Fa icon={faPlus} /> Add Document</button>
      </div>
      {needs.length > 0 && (
        <section className="hr-needs" aria-label="Documents needing action">
          <header><b>Needs action · {needs.length}</b><small>Every person needs a signed contract and an ID copy on file</small></header>
          <ul>
            {(showAllNeeds ? needs : needs.slice(0, 6)).map(n => (
              <li key={n.id}>
                <span className="hr-needs__who">{empName(n.employeeId)}</span>
                <span className="hr-needs__what">{n.what}</span>
                <span className={`hr-needs__chip is-${n.tone}`}>{n.problem}</span>
                <button type="button" className="btn-outline text-[11px]" onClick={() => openFor(n.employeeId, n.type)}>{n.action}</button>
              </li>
            ))}
          </ul>
          {needs.length > 6 && <button type="button" className="hr-needs__more" onClick={() => setShowAllNeeds(v => !v)}>{showAllNeeds ? 'Show fewer' : `Show all ${needs.length}`}</button>}
        </section>
      )}
      {(expiring > 0 || expired > 0) && (
        <div className="hr-submodule-alert m-4 mb-0 rounded-xl p-3 flex items-center justify-between gap-3 text-[12px]" style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A', color: 'var(--warning-text)' }}>
          <span>
            {expired > 0 && <><strong>{expired} expired</strong>{expiring > 0 ? ' and ' : ''}</>}
            {expiring > 0 && <strong>{expiring} expiring within 60 days</strong>}
            {' '}— renew these contracts, permits or certificates.
          </span>
          <button className="btn-outline text-[11px]" onClick={() => setFilter(f => f === 'all' ? 'attention' : 'all')}>{filter === 'all' ? 'Show only these' : 'Show all'}</button>
        </div>
      )}
      <DataTable
        tableId="hr_documents"
        columns={columns}
        rows={visibleDocs}
        rowKey={d => d.id}
        emptyMessage="No HR documents recorded yet"
        exportTitle="HR Documents"
        exportFilename="hr-documents"
      />
      {show && (
        <Modal title="Add HR Document" onClose={() => setShow(false)} width={480}>
          <div className="flex flex-col gap-4">
            <Field label="Employee" required>
              <Select value={form.employeeId} onChange={set('employeeId')} options={[{ value: '', label: '— Select —' }, ...employees.map(e => ({ value: e.id, label: e.fullName }))]} />
            </Field>
            <div className="hr-form-grid grid grid-cols-2 gap-4">
              <Field label="Type" required><Select value={form.type} onChange={set('type')} options={[{ value: '', label: 'Select type…' }, ...DOC_TYPES]} /></Field>
              <Field label="Expiry Date"><Input type="date" value={form.expiryDate} onChange={set('expiryDate')} /></Field>
            </div>
            <Field label="Title" required><Input value={form.title} onChange={set('title')} placeholder="e.g. Employment Contract 2026" /></Field>
            <Field label="Who can see it">
              <Select value={form.visibility} onChange={set('visibility')} options={[
                { value: 'hr_only', label: 'HR only' },
                { value: 'hr_finance', label: 'HR and finance' },
                { value: 'employee_visible', label: 'HR, finance and the employee (shown in their portal)' },
              ]} />
            </Field>
            <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} rows={2} /></Field>
            <Field label="File (PDF or image, up to 4 MB)">
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
            </Field>
            <div className="hr-modal-actions flex justify-end gap-2"><button className="btn-outline" onClick={() => { setShow(false); setFile(null) }}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── HR Reports ────────────────────────────────────────────────────────────────
export function HRReportsTab() {
  const { employees, leaveRequests, trainingPrograms, employeeTrainings } = useHrStore()
  const { payrollRuns } = useApp()

  const stats = useMemo(() => {
    const active = employees.filter(e => e.status === 'active')
    const byDept = new Map<string, number>()
    active.forEach(e => byDept.set(e.departmentId || 'Unassigned', (byDept.get(e.departmentId || 'Unassigned') ?? 0) + 1))
    const pendingLeave = leaveRequests.filter(r => r.status === 'pending_hr').length
    const latestRun = [...payrollRuns].sort((a, b) => `${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`))[0]
    const trainingCompletion = employeeTrainings.length
      ? Math.round((employeeTrainings.filter(t => t.status === 'completed').length / employeeTrainings.length) * 100)
      : 0
    return {
      headcount: active.length,
      exited: employees.length - active.length,
      byDept: Array.from(byDept.entries()).sort((a, b) => b[1] - a[1]),
      pendingLeave,
      latestRun,
      trainingCompletion,
      programs: trainingPrograms.length,
    }
  }, [employees, leaveRequests, payrollRuns, employeeTrainings, trainingPrograms])

  return (
    <div className="hr-submodule hr-reports hr-submodule-content p-4 flex flex-col gap-4">
      <div className="hr-report-card rounded-xl border border-[var(--border-lt)] p-4">
        <h3 className="text-sm font-bold text-[var(--text-1)] mb-3 flex items-center gap-2"><Fa icon={faBuilding} /> Headcount by Department</h3>
        {stats.byDept.length === 0
          ? <p className="text-xs text-[var(--text-4)]">No active employees</p>
          : (
            /* Every bar used to render empty: the fill carried its colour as an
               inline `background: var(--primary)` shorthand, which painted
               nothing, so four departments all looked like blank tracks. The
               colour is a class now and only the share is inline. */
            <dl className="hr-bars">
              {stats.byDept.map(([dept, count]) => {
                const share = stats.headcount ? (count / stats.headcount) * 100 : 0
                return (
                  <div className="hr-bars__row" key={dept}>
                    <dt className="hr-bars__label" title={dept}>{dept}</dt>
                    <div
                      className="hr-bars__track"
                      role="img"
                      aria-label={`${dept}: ${count} of ${stats.headcount} (${Math.round(share)}%)`}
                    >
                      <div className="hr-bars__fill" style={{ ['--hr-bar-share' as string]: `${share}%` }} />
                    </div>
                    <dd className="hr-bars__value">
                      {count}
                      <span className="hr-bars__share">{Math.round(share)}%</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          )}
      </div>
      <PolicyAckReport />
    </div>
  )
}
