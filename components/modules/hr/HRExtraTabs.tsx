'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, fmtDate } from '@/lib/store'
import { useHrStore } from '@/hooks/useHrStore'
import { Field, Input, Modal, Select, Textarea, Badge } from '@/components/ui'
import { Fa } from '@/components/icons'
import { documentExpiry } from '@/lib/hr/document-status'
import { PolicyAckReport } from './HRPolicies'
import { faGraduationCap, faPlus, faBuilding } from '@fortawesome/free-solid-svg-icons'

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

  /** Open the drawer for one person and type, filled in (Upload / Renew). */
  const openFor = (employeeId: string, type: string) => {
    const label = DOC_TYPES.find(t => t.value === type)?.label ?? ''
    setForm({ ...emptyDocForm(), employeeId, type, title: label ? `${label} — ${empName(employeeId)}` : '' })
    setFile(null)
    setShow(true)
  }
  // What HR has to do about papers, most urgent first: the two every person
  // must have on file, then anything expired or ending within 30 days.
  const active = employees.filter(e => e.status !== 'exited')
  const needs = [
    ...active.flatMap(e => (['contract', 'id_copy'] as const)
      .filter(type => !hrDocuments.some(d => d.employeeId === e.id && d.type === type))
      .map(type => ({ id: `${e.id}:${type}`, employeeId: e.id, type, what: type === 'contract' ? 'Employment contract' : 'ID copy', problem: 'Missing', tone: 'r', rank: 0, action: 'Upload' }))),
    ...hrDocuments
      .filter(d => active.some(e => e.id === d.employeeId))
      .map(d => ({ d, x: documentExpiry(d.expiryDate) }))
      .filter(({ x }) => x.status === 'expired' || (x.status === 'expiring' && (x.daysLeft ?? 99) <= 30))
      .map(({ d, x }) => ({
        id: d.id, employeeId: d.employeeId, type: d.type, what: DOC_TYPES.find(t => t.value === d.type)?.label ?? d.title,
        problem: x.status === 'expired' ? 'Expired' : `Ends ${fmtDate(d.expiryDate!).replace(/ \d{4}$/, '')}`,
        tone: x.status === 'expired' ? 'r' : 'a', rank: x.status === 'expired' ? 1 : 2, action: 'Renew',
      })),
  ].sort((a, b) => a.rank - b.rank || empName(a.employeeId).localeCompare(empName(b.employeeId)))
  const [showAllNeeds, setShowAllNeeds] = useState(false)
  const [groupBy, setGroupBy] = useState<'person' | 'type'>('person')
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const typeLabel = (t: string) => DOC_TYPES.find(x => x.value === t)?.label ?? t
  const byPerson = employees
    .map(e => ({ e, docs: hrDocuments.filter(d => d.employeeId === e.id) }))
    .filter(x => x.docs.length > 0 || x.e.status !== 'exited')
    .sort((a, b) => a.e.fullName.localeCompare(b.e.fullName))
  const byType = DOC_TYPES.map(t => ({ t, docs: hrDocuments.filter(d => d.type === t.value) })).filter(x => x.docs.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const ticks = form.type === 'contract' ? 'Contract signed' : form.type === 'id_copy' ? 'ID & KRA PIN copies' : ''

  return (
    <div className={`hrc${show ? ' has-drawer' : ''}`}>
      <div className="hrc-main">
        <section className="hra-card">
          <div className="hra-ch"><b className="hrc-title">Needs action · {needs.length}</b><button type="button" className="hrb-btn is-p" onClick={() => { setForm(emptyDocForm()); setFile(null); setShow(true) }}>+ Add document</button></div>
          {needs.length === 0 ? <p className="hrb-empty">Everyone has a contract and an ID copy on file, and nothing ends in the next 30 days.</p> : (
            <div className="hra-table-wrap">
              <table className="hra-table">
                <thead><tr><th>Person</th><th>Document</th><th>Problem</th><th /></tr></thead>
                <tbody>
                  {(showAllNeeds ? needs : needs.slice(0, 8)).map(n => (
                    <tr key={n.id} className="is-static">
                      <td>{empName(n.employeeId)}</td>
                      <td>{n.what}</td>
                      <td><span className={`hra-chip is-${n.tone}`}>{n.problem}</span></td>
                      <td className="hra-r"><button type="button" className="hrb-btn" onClick={() => openFor(n.employeeId, n.type)}>{n.action}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {needs.length > 8 && <button type="button" className="hrc-more" onClick={() => setShowAllNeeds(v => !v)}>{showAllNeeds ? 'Show fewer' : `Show all ${needs.length}`}</button>}
            </div>
          )}
        </section>

        <section className="hra-card">
          <div className="hra-ch">
            <b className="hrc-title">All documents · {hrDocuments.length}</b>
            <div className="hra-seg" role="tablist" aria-label="Group documents">
              <button type="button" role="tab" aria-selected={groupBy === 'person'} onClick={() => setGroupBy('person')}>By person</button>
              <button type="button" role="tab" aria-selected={groupBy === 'type'} onClick={() => setGroupBy('type')}>By type</button>
            </div>
          </div>
          <div className="hra-table-wrap">
            <table className="hra-table">
              <tbody>
                {groupBy === 'person' && byPerson.map(({ e, docs }) => {
                  const required = (['contract', 'id_copy'] as const).filter(t => docs.some(d => d.type === t)).length
                  const open = openPerson === e.id
                  return (
                    <Fragment key={e.id}>
                      <tr onClick={() => setOpenPerson(open ? null : e.id)}>
                        <td>{e.fullName}</td>
                        <td className="hrc-muted">{docs.length ? [...new Set(docs.map(d => typeLabel(d.type)))].join(' · ') : 'Nothing on file'}</td>
                        <td className="hra-r">{required === 2 ? <span className="hra-chip is-g">{docs.length} on file</span> : <span className="hra-chip is-a">{required} of 2 required</span>}</td>
                      </tr>
                      {open && docs.map(d => {
                        const x = documentExpiry(d.expiryDate)
                        return (
                          <tr key={d.id} className="hrc-sub is-static">
                            <td>{d.title}</td>
                            <td className="hrc-muted">{d.expiryDate ? (x.status === 'expired' ? 'Expired ' : 'Until ') + fmtDate(d.expiryDate) : 'No expiry'} · {d.visibility === 'employee_visible' ? 'Employee too' : d.visibility === 'hr_finance' ? 'HR & Finance' : 'HR only'}</td>
                            <td className="hra-r">{d.fileName ? <a className="hrb-link" href={`/api/hr-documents/${d.id}/file`} target="_blank" rel="noreferrer">View</a> : <span className="hrc-muted">No file</span>}</td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
                {groupBy === 'type' && byType.map(({ t, docs }) => {
                  const soon = docs.filter(d => documentExpiry(d.expiryDate).status !== 'active').length
                  return (
                    <tr key={t.value} className="is-static">
                      <td>{t.label}</td>
                      <td className="hrc-muted">{[...new Set(docs.map(d => empName(d.employeeId)))].slice(0, 4).join(' · ')}{docs.length > 4 ? ' …' : ''}</td>
                      <td className="hra-r">{soon ? <span className="hra-chip is-a">{soon} to renew</span> : <span className="hra-chip is-g">{docs.length} on file</span>}</td>
                    </tr>
                  )
                })}
                {hrDocuments.length === 0 && groupBy === 'type' && <tr className="is-static"><td className="hrb-empty">No documents yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {show && (
        <aside className="hrc-drawer" aria-label="Add document">
          <div className="hrc-drawer-head"><b>Add document</b><button type="button" className="hrc-x" aria-label="Close" onClick={() => { setShow(false); setFile(null) }}>×</button></div>
          <label className="hrc-fld"><span>Person</span>
            <select value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value, title: f.type ? `${typeLabel(f.type)} — ${empName(e.target.value)}` : f.title }))}>
              <option value="">Choose person…</option>
              {employees.filter(e => e.status !== 'exited').map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
            </select>
          </label>
          <label className="hrc-fld"><span>Type</span>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, title: `${typeLabel(e.target.value)} — ${empName(f.employeeId)}` }))}>
              <option value="">Choose type…</option>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button type="button" className={`hrc-drop${file ? ' has-file' : ''}`} onClick={() => fileRef.current?.click()}>
            {file ? <><b>{file.name}</b><span>{Math.round(file.size / 1024)} KB · tap to change</span></> : <><b>Drop the signed PDF or photo here</b><span>or take a photo</span></>}
          </button>
          <input ref={fileRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <label className="hrc-fld"><span>Expires</span><input type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} /><small>Optional</small></label>
          <div className="hrc-fld"><span>Who can see it</span>
            <div className="hra-seg" role="radiogroup" aria-label="Who can see it">
              {([['hr_only', 'HR only'], ['hr_finance', 'HR & Finance'], ['employee_visible', 'Employee too']] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={form.visibility === v} aria-selected={form.visibility === v} onClick={() => setForm(f => ({ ...f, visibility: v }))}>{l}</button>
              ))}
            </div>
          </div>
          <button type="button" className="hrb-btn is-p hrc-save" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : ticks ? `Save · ticks “${ticks}”` : 'Save document'}
          </button>
        </aside>
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
